-- Fix infinite recursion in RLS policies

-- Drop the problematic policies first
DROP POLICY IF EXISTS "Users can view memberships in rooms they belong to" ON chat_room_members;
DROP POLICY IF EXISTS "Users can view rooms they are members of" ON chat_rooms;

-- Recreate fixed policies for chat_room_members
CREATE POLICY "Users can view memberships in rooms they belong to" 
ON chat_room_members 
FOR SELECT 
USING (user_id = auth.uid());

-- Recreate fixed policy for chat_rooms
CREATE POLICY "Users can view rooms they are members of" 
ON chat_rooms 
FOR SELECT 
USING (EXISTS (
  SELECT 1 
  FROM chat_room_members 
  WHERE chat_room_members.chat_room_id = chat_rooms.id 
    AND chat_room_members.user_id = auth.uid()
));