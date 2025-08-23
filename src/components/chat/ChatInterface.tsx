import { useState, useEffect, useRef } from "react";
import { STTStreamer } from "@/integrations/stt/client";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { Send, Languages, LogOut, Settings, UserPlus, Reply, Mic, MicOff } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AuthModal from "@/components/auth/AuthModal";
import RoomSelector from "./RoomSelector";

interface Message {
  id: string;
  user_id: string;
  original_text: string;
  translated_text?: string;
  native_language: string;
  target_language: string;
  chat_room_id: string;
  reply_to_id?: string;
  created_at: string;
  profiles?: {
    display_name?: string;
  };
  reply_to?: {
    id: string;
    original_text: string;
    profiles?: {
      display_name?: string;
    };
  };
}

interface Profile {
  id: string;
  user_id: string;
  display_name?: string;
  native_language: string;
  target_language: string;
}

const LANGUAGES = {
  en: "English",
  es: "Spanish", 
  fr: "French",
  de: "German",
  it: "Italian",
  fi: "Finnish"
};

const ChatInterface = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string>("");
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Mic streaming via WebSocket STT server
  const [isListening, setIsListening] = useState(false);
  const [hasSpeechSupport, setHasSpeechSupport] = useState(false);
  const sttRef = useRef<STTStreamer | null>(null);
  const speechRef = useRef<any | null>(null);
  const baseTextRef = useRef<string>("");
  const accumulatedFinalRef = useRef<string>("");
  const finalTranscriptRef = useRef<string>("");
  const lastFinalIndexRef = useRef<number>(-1);
  const [micPermission, setMicPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [requestingMic, setRequestingMic] = useState(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (user) {
      fetchProfile();
      if (selectedRoomId) {
        fetchMessages();
        setupRealtimeSubscription();
      }
    }
  }, [user, selectedRoomId]);

  // Detect microphone/speech support and permission once
  useEffect(() => {
    const mediaSupported = !!navigator?.mediaDevices?.getUserMedia;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setHasSpeechSupport(!!SpeechRecognition || mediaSupported);
    // Try to detect current microphone permission if supported
    try {
      const navAny = navigator as any;
      if (navAny?.permissions?.query) {
        navAny.permissions
          .query({ name: "microphone" as any })
          .then((status: any) => {
            if (status?.state === "granted") setMicPermission("granted");
            else if (status?.state === "denied") setMicPermission("denied");
            else setMicPermission("unknown");
            if (status?.onchange !== undefined) {
              status.onchange = () => {
                const s = status.state;
                setMicPermission(s === "granted" ? "granted" : s === "denied" ? "denied" : "unknown");
              };
            }
          })
          .catch(() => {});
      }
    } catch {}
    return () => {
      // Cleanup: stop streamer / speech if active
      try {
        sttRef.current?.stop();
      } catch {}
      try {
        if (speechRef.current) {
          speechRef.current.onresult = null;
          speechRef.current.onerror = null;
          speechRef.current.onend = null;
          try { speechRef.current.stop(); } catch {}
          speechRef.current = null;
        }
      } catch {}
    };
  }, []);

  // Keep base text in sync only when NOT listening to avoid re-appending
  useEffect(() => {
    if (!isListening) {
      baseTextRef.current = newMessage;
    }
  }, [newMessage, isListening]);

  const fetchProfile = async () => {
    if (!user) return;

    try {
      let { data: existingProfile } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (!existingProfile) {
        // Create profile if it doesn't exist
        const { data: newProfile, error } = await supabase
          .from("profiles")
          .insert({
            user_id: user.id,
            display_name: user.email?.split("@")[0] || "Anonymous",
            native_language: "en",
            target_language: "fi",
            is_anonymous: user.is_anonymous || false
          })
          .select()
          .single();

        if (error) throw error;
        setProfile(newProfile);
      } else {
        setProfile(existingProfile);
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
      toast({
        title: "Error",
        description: "Failed to load profile",
        variant: "destructive"
      });
    }
  };

  const fetchMessages = async () => {
    if (!selectedRoomId) return;

    try {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("chat_room_id", selectedRoomId)
        .order("created_at", { ascending: true })
        .limit(50);

      if (error) throw error;

      const messages = data || [];
      const userIds = [...new Set(messages.map(msg => msg.user_id))];
      const replyToIds = messages.filter(msg => msg.reply_to_id).map(msg => msg.reply_to_id);
      
      // Fetch profiles for message authors
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", userIds);

      const profileMap = profiles?.reduce((acc, profile) => {
        acc[profile.user_id] = profile;
        return acc;
      }, {} as Record<string, any>) || {};

      // Fetch reply messages if needed
      let replyMessages: any[] = [];
      if (replyToIds.length > 0) {
        const { data: replies } = await supabase
          .from("messages")
          .select("id, original_text, user_id")
          .in("id", replyToIds);
        replyMessages = replies || [];
      }

      const messagesWithProfiles = messages.map(msg => {
        const replyData = replyToIds.includes(msg.reply_to_id) 
          ? replyMessages.find(r => r.id === msg.reply_to_id)
          : null;

        return {
          ...msg,
          profiles: profileMap[msg.user_id] || { display_name: "Anonymous" },
          reply_to: replyData ? {
            id: replyData.id,
            original_text: replyData.original_text,
            profiles: profileMap[replyData.user_id] || { display_name: "Anonymous" }
          } : undefined
        };
      });

      setMessages(messagesWithProfiles);
    } catch (error) {
      console.error("Error fetching messages:", error);
      toast({
        title: "Error",
        description: "Failed to load messages",
        variant: "destructive"
      });
    }
  };

  const setupRealtimeSubscription = () => {
    if (!selectedRoomId) return;

    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_room_id=eq.${selectedRoomId}`
        },
        async (payload) => {
          const newMessage = payload.new as Message;
          
          // Fetch the profile data for the new message
          const { data: profileData } = await supabase
            .from("profiles")
            .select("display_name")
            .eq("user_id", newMessage.user_id)
            .single();

          // Fetch reply data if applicable
          let replyData = null;
          if (newMessage.reply_to_id) {
            const { data } = await supabase
              .from("messages")
              .select("id, original_text, user_id")
              .eq("id", newMessage.reply_to_id)
              .single();
            
            if (data) {
              const { data: replyProfile } = await supabase
                .from("profiles")
                .select("display_name")
                .eq("user_id", data.user_id)
                .single();
              
              replyData = {
                id: data.id,
                original_text: data.original_text,
                profiles: replyProfile || { display_name: "Anonymous" }
              };
            }
          }

          const messageWithProfile = {
            ...newMessage,
            profiles: profileData,
            reply_to: replyData
          };

          setMessages(prev => [...prev, messageWithProfile]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  // Map app language codes to BCP-47 for SpeechRecognition
  const SPEECH_LANGS: Record<string, string> = {
    en: "en-US",
    es: "es-ES",
    fr: "fr-FR",
    de: "de-DE",
    it: "it-IT",
    fi: "fi-FI",
  };

  const startBrowserSpeech = async (): Promise<boolean> => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return false;
    try {
      const permitted = await ensureMicPermission();
      if (!permitted) return false;
      const recog = new SR();
      speechRef.current = recog;
      recog.continuous = true;
      recog.interimResults = true;
      const langCode = SPEECH_LANGS[profile?.native_language || 'en'] || 'en-US';
      recog.lang = langCode;

      baseTextRef.current = newMessage;
      accumulatedFinalRef.current = "";
      finalTranscriptRef.current = "";
      lastFinalIndexRef.current = -1;

      recog.onresult = (event: any) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) {
            finalTranscriptRef.current = [finalTranscriptRef.current, res[0].transcript].filter(Boolean).join(" ");
          } else {
            interim = res[0].transcript;
          }
        }
        const combined = [baseTextRef.current, finalTranscriptRef.current, interim].filter(Boolean).join(" ").trim();
        setNewMessage(combined);
      };

      recog.onerror = (e: any) => {
        console.error('[SpeechRecognition error]', e);
        try { recog.stop(); } catch {}
        speechRef.current = null;
        // Fallback to WS streamer on error
        startWSStreamerFallback();
      };

      recog.onend = () => {
        // Stop listening when recognition naturally ends
        setIsListening(false);
      };

      recog.start();
      setIsListening(true);
      return true;
    } catch (e) {
      console.error('Failed to start SpeechRecognition', e);
      return false;
    }
  };

  const startWSStreamerFallback = async () => {
    const wsUrl = (import.meta as any).env?.VITE_STT_WS_URL || "ws://100.127.47.73:8765";
    const stt = new STTStreamer(wsUrl);
    sttRef.current = stt;

    stt.onReady = (info) => {
      console.log("[STT ready]", info);
    };
    stt.onPartial = (t) => {
      const combined = [baseTextRef.current, finalTranscriptRef.current, t]
        .filter(Boolean)
        .join(" ")
        .trim();
      setNewMessage(combined);
    };
    stt.onResult = (t) => {
      if (t) {
        finalTranscriptRef.current = [finalTranscriptRef.current, t].filter(Boolean).join(" ");
        const combined = [baseTextRef.current, finalTranscriptRef.current]
          .filter(Boolean)
          .join(" ")
          .trim();
        setNewMessage(combined);
      }
    };
    stt.onFinal = (t) => {
      if (t) {
        finalTranscriptRef.current = [finalTranscriptRef.current, t].filter(Boolean).join(" ");
        const combined = [baseTextRef.current, finalTranscriptRef.current]
          .filter(Boolean)
          .join(" ")
          .trim();
        setNewMessage(combined);
      }
      setIsListening(false);
    };
    stt.onError = (err) => {
      console.error("[STT error]", err);
      toast({
        title: "Voice input error",
        description: err.message || "Streaming failed.",
        variant: "destructive",
      });
      setIsListening(false);
    };

    try {
      await stt.start();
      setIsListening(true);
    } catch (err: any) {
      console.error("Failed to start STT streamer", err);
      toast({
        title: "Voice input error",
        description: err?.message || "Could not start microphone streaming.",
        variant: "destructive",
      });
      setIsListening(false);
    }
  };

  const ensureMicPermission = async (): Promise<boolean> => {
    if (micPermission === "granted") return true;
    if (!navigator?.mediaDevices?.getUserMedia) return true; // fallback; some browsers prompt on start
    try {
      setRequestingMic(true);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Immediately stop tracks; we only needed permission
      stream.getTracks().forEach((t) => t.stop());
      setMicPermission("granted");
      return true;
    } catch (e) {
      setMicPermission("denied");
      toast({
        title: "Microphone blocked",
        description: "Please allow microphone access in your browser settings to use voice input.",
        variant: "destructive",
      });
      return false;
    } finally {
      setRequestingMic(false);
    }
  };

  const startVoiceInput = async () => {
    if (isListening) return;
    // Try SpeechRecognition first; if unavailable or error, fallback to WS streamer
    const startedSpeech = await startBrowserSpeech();
    if (!startedSpeech) {
      // Snapshot current text so interim results append during this session
      baseTextRef.current = newMessage;
      accumulatedFinalRef.current = "";
      finalTranscriptRef.current = "";
      lastFinalIndexRef.current = -1;
      await startWSStreamerFallback();
    }
  };

  const stopVoiceInput = () => {
    try {
      sttRef.current?.stop();
    } catch {}
    try {
      if (speechRef.current) {
        speechRef.current.onresult = null;
        speechRef.current.onerror = null;
        speechRef.current.onend = null;
        speechRef.current.stop();
        speechRef.current = null;
      }
    } catch {}
    setIsListening(false);
  };

  const toggleVoiceInput = async () => {
    if (isListening) {
      stopVoiceInput();
    } else {
      await startVoiceInput();
    }
  };

  const translateMessage = async (text: string, sourceLang: string, targetLang: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('translate-message', {
        body: {
          text,
          source: sourceLang,
          target: targetLang
        }
      });

      if (error) {
        console.error("Translation error:", error);
        return `[Translation failed] ${text}`;
      }
      return data.translatedText;
    } catch (error) {
      console.error("Translation error:", error);
      return `[Translation failed] ${text}`;
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !user || !profile || !selectedRoomId) return;

    setLoading(true);
    try {
      // If recording, stop so the text doesn't change mid-send
      if (isListening) {
        stopVoiceInput();
      }
      // Translate if needed
      let translatedText = null;
      if (profile.native_language !== profile.target_language) {
        console.log("Translating message from", profile.native_language, "to", profile.target_language);
        translatedText = await translateMessage(
          newMessage, 
          profile.native_language, 
          profile.target_language
        );
        console.log("Translation result:", translatedText);
      }

      const { error } = await supabase
        .from("messages")
        .insert({
          user_id: user.id,
          original_text: newMessage,
          translated_text: translatedText,
          native_language: profile.native_language,
          target_language: profile.target_language,
          chat_room_id: selectedRoomId,
          reply_to_id: replyingTo?.id || null
        });

      if (error) throw error;

      setNewMessage("");
      setReplyingTo(null);
      toast({
        title: "Message sent!",
        description: translatedText ? "Message translated and sent" : "Message sent"
      });
    } catch (error) {
      console.error("Error sending message:", error);
      toast({
        title: "Error",
        description: "Failed to send message",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const updateLanguageSettings = async (field: 'native_language' | 'target_language', value: string) => {
    if (!profile) return;

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ [field]: value })
        .eq("user_id", user!.id);

      if (error) throw error;

      setProfile({ ...profile, [field]: value });
      toast({
        title: "Settings updated",
        description: "Language preferences saved"
      });
    } catch (error) {
      console.error("Error updating language:", error);
      toast({
        title: "Error",
        description: "Failed to update language settings",
        variant: "destructive"
      });
    }
  };

  const handleSignOut = async () => {
    await signOut();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Loading your profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col gradient-chat">
      {/* Header */}
      <div className="bg-card border-b p-4">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <div className="flex items-center space-x-2">
            <Languages className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-bold">Globe Chat</h1>
          </div>
          <div className="flex items-center space-x-2">
            {user?.is_anonymous && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAuthModal(true)}
                className="text-accent hover:text-accent-foreground"
              >
                <UserPlus className="w-4 h-4 mr-1" />
                Sign Up
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSettings(!showSettings)}
            >
              <Settings className="w-4 h-4" />
            </Button>
            {!user?.is_anonymous && (
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                <LogOut className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Language Settings */}
      {showSettings && (
        <Card className="mx-4 mt-4 p-4 animate-slide-up">
          <div className="max-w-6xl mx-auto">
            <h3 className="font-semibold mb-4">Language Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">I speak:</label>
                <Select
                  value={profile.native_language}
                  onValueChange={(value) => updateLanguageSettings('native_language', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(LANGUAGES).map(([code, name]) => (
                      <SelectItem key={code} value={code}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Translate to:</label>
                <Select
                  value={profile.target_language}
                  onValueChange={(value) => updateLanguageSettings('target_language', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(LANGUAGES).map(([code, name]) => (
                      <SelectItem key={code} value={code}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Room Selector */}
        <RoomSelector 
          selectedRoomId={selectedRoomId}
          onRoomSelect={setSelectedRoomId}
        />

        {/* Messages */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4">
            <div className="max-w-4xl mx-auto space-y-4">
              {!selectedRoomId ? (
                <div className="text-center text-muted-foreground">
                  Select a chat room to start messaging
                </div>
              ) : (
                messages.map((message) => {
                  const isOwnMessage = message.user_id === user?.id;
                  return (
                    <div
                      key={message.id}
                      className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} animate-slide-up group`}
                    >
                      <div className={`flex items-start space-x-2 max-w-xs lg:max-w-md ${isOwnMessage ? 'flex-row-reverse space-x-reverse' : ''}`}>
                        <Avatar className="w-8 h-8">
                          <AvatarFallback>
                            {(message.profiles?.display_name || 'A')[0].toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="relative">
                          <div className={`rounded-lg p-3 message-shadow ${
                            isOwnMessage 
                              ? 'bg-message-sent text-message-sent-foreground' 
                              : 'bg-message-received text-message-received-foreground'
                          }`}>
                            {/* Reply indicator */}
                            {message.reply_to && (
                              <div className="mb-2 p-2 bg-black/10 rounded text-xs">
                                <div className="font-medium text-muted-foreground">
                                  Replying to {message.reply_to.profiles?.display_name || 'Anonymous'}
                                </div>
                                <div className="truncate">
                                  {message.reply_to.original_text}
                                </div>
                              </div>
                            )}
                            
                            <div className="text-xs text-muted-foreground mb-1">
                              {message.profiles?.display_name || 'Anonymous'} • {LANGUAGES[message.native_language as keyof typeof LANGUAGES]}
                            </div>
                            <p className="text-sm">{message.original_text}</p>
                            {message.translated_text && message.translated_text !== message.original_text && (
                              <div className="mt-2 pt-2 border-t border-message-translation/20">
                                <div className="text-xs text-message-translation-foreground mb-1">
                                  Translated to {LANGUAGES[message.target_language as keyof typeof LANGUAGES]}
                                </div>
                                <p className="text-sm text-message-translation-foreground italic">
                                  {message.translated_text}
                                </p>
                              </div>
                            )}
                          </div>
                          
                          {/* Reply button */}
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`absolute top-0 opacity-0 group-hover:opacity-100 transition-opacity ${
                              isOwnMessage ? '-left-8' : '-right-8'
                            }`}
                            onClick={() => setReplyingTo(message)}
                          >
                            <Reply className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Message Input */}
          <div className="border-t bg-card p-4">
            <div className="max-w-4xl mx-auto">
              {/* Reply indicator */}
              {replyingTo && (
                <div className="mb-2 p-2 bg-muted rounded-lg flex items-center justify-between">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Replying to </span>
                    <span className="font-medium">{replyingTo.profiles?.display_name || 'Anonymous'}</span>
                    <div className="text-xs text-muted-foreground truncate">
                      {replyingTo.original_text}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setReplyingTo(null)}
                  >
                    ×
                  </Button>
                </div>
              )}
              
              <div className="flex space-x-2">
                <Input
                  placeholder={selectedRoomId ? `Type in ${LANGUAGES[profile.native_language as keyof typeof LANGUAGES]}...` : "Select a room to start messaging"}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  disabled={loading || !selectedRoomId}
                />
                {hasSpeechSupport && (
                  <Button
                    type="button"
                    variant={isListening ? "secondary" : "outline"}
                    onClick={toggleVoiceInput}
                    disabled={loading || !selectedRoomId}
                    aria-pressed={isListening}
                    title={isListening ? "Stop voice input" : "Start voice input"}
                  >
                    {isListening ? <MicOff className="w-4 h-4 text-red-500" /> : <Mic className="w-4 h-4" />}
                  </Button>
                )}
                <Button 
                  onClick={sendMessage} 
                  disabled={loading || !newMessage.trim() || !selectedRoomId}
                  className="gradient-primary"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
              {profile.native_language !== profile.target_language && (
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  Messages will be translated from {LANGUAGES[profile.native_language as keyof typeof LANGUAGES]} to {LANGUAGES[profile.target_language as keyof typeof LANGUAGES]}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => setShowAuthModal(false)} 
      />
    </div>
  );
};

export default ChatInterface;
