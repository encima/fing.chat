-- Create app_role enum for user roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Create user_roles table
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create chat_rooms table
CREATE TABLE public.chat_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    is_public BOOLEAN NOT NULL DEFAULT true,
    is_system BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on chat_rooms
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;

-- Create chat_room_members table
CREATE TABLE public.chat_room_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_room_id UUID REFERENCES public.chat_rooms(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (chat_room_id, user_id)
);

-- Enable RLS on chat_room_members
ALTER TABLE public.chat_room_members ENABLE ROW LEVEL SECURITY;

-- Add chat_room_id and reply_to_id to messages table
ALTER TABLE public.messages 
ADD COLUMN chat_room_id UUID REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
ADD COLUMN reply_to_id UUID REFERENCES public.messages(id) ON DELETE SET NULL;

-- Create index for better performance
CREATE INDEX idx_messages_chat_room_id ON public.messages(chat_room_id);
CREATE INDEX idx_messages_reply_to_id ON public.messages(reply_to_id);
CREATE INDEX idx_chat_room_members_room_user ON public.chat_room_members(chat_room_id, user_id);

-- RLS Policies for user_roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
ON public.user_roles
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for chat_rooms
CREATE POLICY "Everyone can view public chat rooms"
ON public.chat_rooms
FOR SELECT
USING (is_public = true);

CREATE POLICY "Users can view rooms they are members of"
ON public.chat_rooms
FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.chat_room_members 
        WHERE chat_room_id = id AND user_id = auth.uid()
    )
);

CREATE POLICY "Admins can create chat rooms"
ON public.chat_rooms
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update chat rooms"
ON public.chat_rooms
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for chat_room_members
CREATE POLICY "Users can view memberships in rooms they belong to"
ON public.chat_room_members
FOR SELECT
USING (
    user_id = auth.uid() OR 
    EXISTS (
        SELECT 1 FROM public.chat_room_members cm 
        WHERE cm.chat_room_id = chat_room_id AND cm.user_id = auth.uid()
    )
);

CREATE POLICY "Users can join public rooms"
ON public.chat_room_members
FOR INSERT
WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
        SELECT 1 FROM public.chat_rooms 
        WHERE id = chat_room_id AND is_public = true
    )
);

CREATE POLICY "Admins can add users to any room"
ON public.chat_room_members
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Update messages RLS policies to include chat room access
DROP POLICY "Authenticated users can view their own messages" ON public.messages;

CREATE POLICY "Users can view messages in rooms they are members of"
ON public.messages
FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.chat_room_members 
        WHERE chat_room_id = messages.chat_room_id AND user_id = auth.uid()
    )
);

CREATE POLICY "Users can insert messages in rooms they are members of"
ON public.messages
FOR INSERT
WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
        SELECT 1 FROM public.chat_room_members 
        WHERE chat_room_id = messages.chat_room_id AND user_id = auth.uid()
    )
);

CREATE POLICY "Users can update their own messages"
ON public.messages
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own messages"
ON public.messages
FOR DELETE
USING (auth.uid() = user_id);

-- Function to create default rooms for new users
CREATE OR REPLACE FUNCTION public.create_default_rooms_for_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    global_room_id UUID;
    private_room_id UUID;
BEGIN
    -- Get or create global room
    SELECT id INTO global_room_id
    FROM public.chat_rooms 
    WHERE name = 'Global Chat' AND is_system = true;
    
    IF global_room_id IS NULL THEN
        INSERT INTO public.chat_rooms (name, description, is_public, is_system)
        VALUES ('Global Chat', 'Public chat for all users', true, true)
        RETURNING id INTO global_room_id;
    END IF;
    
    -- Create private room for user
    INSERT INTO public.chat_rooms (name, description, is_public, is_system, created_by)
    VALUES (
        'My Private Notes', 
        'Private room for personal messages', 
        false, 
        true, 
        NEW.id
    )
    RETURNING id INTO private_room_id;
    
    -- Add user to global room
    INSERT INTO public.chat_room_members (chat_room_id, user_id)
    VALUES (global_room_id, NEW.id);
    
    -- Add user to their private room
    INSERT INTO public.chat_room_members (chat_room_id, user_id)
    VALUES (private_room_id, NEW.id);
    
    -- Give first user admin role
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
        INSERT INTO public.user_roles (user_id, role)
        VALUES (NEW.id, 'admin');
    ELSE
        INSERT INTO public.user_roles (user_id, role)
        VALUES (NEW.id, 'user');
    END IF;
    
    RETURN NEW;
END;
$$;

-- Trigger to create default rooms for new users
CREATE TRIGGER on_auth_user_created_rooms
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.create_default_rooms_for_user();

-- Update trigger for chat_rooms updated_at
CREATE TRIGGER update_chat_rooms_updated_at
    BEFORE UPDATE ON public.chat_rooms
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();