-- CRITICAL SECURITY FIXES

-- 1. Fix profiles table RLS policies
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;

-- Create secure profile policies
CREATE POLICY "Users can view their own profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = user_id);

-- Allow viewing display_name and avatar_url for public chat functionality
CREATE POLICY "Public profile info viewable by authenticated users" 
ON public.profiles 
FOR SELECT 
USING (auth.role() = 'authenticated');

-- 2. Fix messages table RLS policies
DROP POLICY IF EXISTS "Messages are viewable by everyone" ON public.messages;

-- Create secure message policies - users can only see their own messages
CREATE POLICY "Users can view their own messages" 
ON public.messages 
FOR SELECT 
USING (auth.uid() = user_id);

-- Add missing UPDATE and DELETE policies for messages
CREATE POLICY "Users can update their own messages" 
ON public.messages 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own messages" 
ON public.messages 
FOR DELETE 
USING (auth.uid() = user_id);

-- 3. Secure the msgs table (currently has NO RLS)
ALTER TABLE public.msgs ENABLE ROW LEVEL SECURITY;

-- Create basic policies for msgs table
CREATE POLICY "Users can view their own msgs" 
ON public.msgs 
FOR SELECT 
USING (auth.uid()::text = "from" OR auth.uid()::text = "to");

CREATE POLICY "Users can insert their own msgs" 
ON public.msgs 
FOR INSERT 
WITH CHECK (auth.uid()::text = "from");

CREATE POLICY "Users can update their own msgs" 
ON public.msgs 
FOR UPDATE 
USING (auth.uid()::text = "from");

CREATE POLICY "Users can delete their own msgs" 
ON public.msgs 
FOR DELETE 
USING (auth.uid()::text = "from" OR auth.uid()::text = "to");

-- 4. Fix function security - add proper search_path
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;