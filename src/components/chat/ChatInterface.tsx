import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { Send, Languages, LogOut, Settings } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Message {
  id: string;
  user_id: string;
  original_text: string;
  translated_text?: string;
  native_language: string;
  target_language: string;
  created_at: string;
  profiles?: {
    display_name?: string;
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
  pt: "Portuguese",
  ru: "Russian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  ar: "Arabic",
  hi: "Hindi"
};

const ChatInterface = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (user) {
      fetchProfile();
      fetchMessages();
      setupRealtimeSubscription();
    }
  }, [user]);

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
            target_language: "es",
            is_anonymous: false
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
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(50);

      if (error) throw error;

      // Fetch profiles separately
      const messages = data || [];
      const userIds = [...new Set(messages.map(msg => msg.user_id))];
      
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", userIds);

      const profileMap = profiles?.reduce((acc, profile) => {
        acc[profile.user_id] = profile;
        return acc;
      }, {} as Record<string, any>) || {};

      const messagesWithProfiles = messages.map(msg => ({
        ...msg,
        profiles: profileMap[msg.user_id] || { display_name: "Anonymous" }
      }));

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
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages'
        },
        async (payload) => {
          const newMessage = payload.new as Message;
          
          // Fetch the profile data for the new message
          const { data: profileData } = await supabase
            .from("profiles")
            .select("display_name")
            .eq("user_id", newMessage.user_id)
            .single();

          const messageWithProfile = {
            ...newMessage,
            profiles: profileData
          };

          setMessages(prev => [...prev, messageWithProfile]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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

      if (error) throw error;
      return data.translatedText;
    } catch (error) {
      console.error("Translation error:", error);
      return null;
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !user || !profile) return;

    setLoading(true);
    try {
      // Translate if needed
      let translatedText = null;
      if (profile.native_language !== profile.target_language) {
        translatedText = await translateMessage(
          newMessage, 
          profile.native_language, 
          profile.target_language
        );
      }

      const { error } = await supabase
        .from("messages")
        .insert({
          user_id: user.id,
          original_text: newMessage,
          translated_text: translatedText,
          native_language: profile.native_language,
          target_language: profile.target_language
        });

      if (error) throw error;

      setNewMessage("");
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
    await supabase.auth.signOut();
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
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <div className="flex items-center space-x-2">
            <Languages className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-bold">Globe Chat</h1>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSettings(!showSettings)}
            >
              <Settings className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Language Settings */}
      {showSettings && (
        <Card className="mx-4 mt-4 p-4 animate-slide-up">
          <div className="max-w-4xl mx-auto">
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages.map((message) => {
            const isOwnMessage = message.user_id === user?.id;
            return (
              <div
                key={message.id}
                className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} animate-slide-up`}
              >
                <div className={`flex items-start space-x-2 max-w-xs lg:max-w-md ${isOwnMessage ? 'flex-row-reverse space-x-reverse' : ''}`}>
                  <Avatar className="w-8 h-8">
                    <AvatarFallback>
                      {(message.profiles?.display_name || 'A')[0].toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className={`rounded-lg p-3 message-shadow ${
                    isOwnMessage 
                      ? 'bg-message-sent text-message-sent-foreground' 
                      : 'bg-message-received text-message-received-foreground'
                  }`}>
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
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Message Input */}
      <div className="border-t bg-card p-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex space-x-2">
            <Input
              placeholder={`Type in ${LANGUAGES[profile.native_language as keyof typeof LANGUAGES]}...`}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={loading}
            />
            <Button 
              onClick={sendMessage} 
              disabled={loading || !newMessage.trim()}
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
  );
};

export default ChatInterface;