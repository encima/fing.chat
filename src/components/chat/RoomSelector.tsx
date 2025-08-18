import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, Hash, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface ChatRoom {
  id: string;
  name: string;
  description?: string;
  is_public: boolean;
  is_system: boolean;
  created_by?: string;
  created_at: string;
}

interface RoomSelectorProps {
  selectedRoomId?: string;
  onRoomSelect: (roomId: string) => void;
}

const RoomSelector = ({ selectedRoomId, onRoomSelect }: RoomSelectorProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomDescription, setNewRoomDescription] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      fetchRooms();
      checkAdminRole();
    }
  }, [user]);

  const checkAdminRole = async () => {
    if (!user) return;

    try {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .single();
      
      setIsAdmin(!!data);
    } catch (error) {
      // Not admin, no error needed
      setIsAdmin(false);
    }
  };

  const fetchRooms = async () => {
    if (!user) return;

    try {
      // Get rooms user is a member of
      const { data: memberRooms, error } = await supabase
        .from("chat_room_members")
        .select(`
          chat_room_id,
          chat_rooms (
            id,
            name,
            description,
            is_public,
            is_system,
            created_by,
            created_at
          )
        `)
        .eq("user_id", user.id);

      if (error) throw error;

      const rooms = memberRooms?.map(member => member.chat_rooms).filter(Boolean) || [];
      setRooms(rooms);

      // Auto-select first room if none selected
      if (!selectedRoomId && rooms.length > 0) {
        onRoomSelect(rooms[0].id);
      }
    } catch (error) {
      console.error("Error fetching rooms:", error);
      toast({
        title: "Error",
        description: "Failed to load chat rooms",
        variant: "destructive"
      });
    }
  };

  const createRoom = async () => {
    if (!newRoomName.trim() || !user) return;

    setLoading(true);
    try {
      // Create room
      const { data: room, error: roomError } = await supabase
        .from("chat_rooms")
        .insert({
          name: newRoomName,
          description: newRoomDescription || null,
          is_public: true,
          created_by: user.id
        })
        .select()
        .single();

      if (roomError) throw roomError;

      // Add creator to room
      const { error: memberError } = await supabase
        .from("chat_room_members")
        .insert({
          chat_room_id: room.id,
          user_id: user.id
        });

      if (memberError) throw memberError;

      setNewRoomName("");
      setNewRoomDescription("");
      setShowCreateRoom(false);
      fetchRooms();
      
      toast({
        title: "Room created!",
        description: `Created "${newRoomName}" successfully`
      });
    } catch (error) {
      console.error("Error creating room:", error);
      toast({
        title: "Error", 
        description: "Failed to create room",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-80 h-full p-4 border-r">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Chat Rooms</h3>
          {isAdmin && (
            <Dialog open={showCreateRoom} onOpenChange={setShowCreateRoom}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Plus className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Room</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <Input
                    placeholder="Room name"
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                  />
                  <Textarea
                    placeholder="Room description (optional)"
                    value={newRoomDescription}
                    onChange={(e) => setNewRoomDescription(e.target.value)}
                  />
                  <Button 
                    onClick={createRoom} 
                    disabled={loading || !newRoomName.trim()}
                    className="w-full"
                  >
                    Create Room
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="space-y-2">
          {rooms.map((room) => (
            <button
              key={room.id}
              onClick={() => onRoomSelect(room.id)}
              className={`w-full text-left p-3 rounded-lg transition-colors ${
                selectedRoomId === room.id
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              <div className="flex items-center space-x-2">
                {room.is_public ? (
                  <Hash className="w-4 h-4" />
                ) : (
                  <Lock className="w-4 h-4" />
                )}
                <span className="font-medium truncate">{room.name}</span>
              </div>
              {room.description && (
                <p className="text-sm text-muted-foreground mt-1 truncate">
                  {room.description}
                </p>
              )}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
};

export default RoomSelector;