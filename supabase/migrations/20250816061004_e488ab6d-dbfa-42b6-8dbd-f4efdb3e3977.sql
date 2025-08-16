-- Fix anonymous access warnings by restricting all policies to authenticated users only

-- 1. Update profiles policies to authenticated users only
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Public profile info viewable by authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

-- Recreate profiles policies for authenticated users only
CREATE POLICY "Authenticated users can view their own profile" 
ON public.profiles 
FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can view public profile info" 
ON public.profiles 
FOR SELECT 
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can update their own profile" 
ON public.profiles 
FOR UPDATE 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can insert their own profile" 
ON public.profiles 
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- 2. Update messages policies to authenticated users only
DROP POLICY IF EXISTS "Users can view their own messages" ON public.messages;
DROP POLICY IF EXISTS "Users can update their own messages" ON public.messages;
DROP POLICY IF EXISTS "Users can delete their own messages" ON public.messages;
DROP POLICY IF EXISTS "Users can insert their own messages" ON public.messages;

-- Recreate messages policies for authenticated users only
CREATE POLICY "Authenticated users can view their own messages" 
ON public.messages 
FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can insert their own messages" 
ON public.messages 
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can update their own messages" 
ON public.messages 
FOR UPDATE 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can delete their own messages" 
ON public.messages 
FOR DELETE 
TO authenticated
USING (auth.uid() = user_id);

-- 3. Update msgs policies to authenticated users only
DROP POLICY IF EXISTS "Users can view their own msgs" ON public.msgs;
DROP POLICY IF EXISTS "Users can insert their own msgs" ON public.msgs;
DROP POLICY IF EXISTS "Users can update their own msgs" ON public.msgs;
DROP POLICY IF EXISTS "Users can delete their own msgs" ON public.msgs;

-- Recreate msgs policies for authenticated users only
CREATE POLICY "Authenticated users can view their own msgs" 
ON public.msgs 
FOR SELECT 
TO authenticated
USING (auth.uid()::text = "from" OR auth.uid()::text = "to");

CREATE POLICY "Authenticated users can insert their own msgs" 
ON public.msgs 
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid()::text = "from");

CREATE POLICY "Authenticated users can update their own msgs" 
ON public.msgs 
FOR UPDATE 
TO authenticated
USING (auth.uid()::text = "from");

CREATE POLICY "Authenticated users can delete their own msgs" 
ON public.msgs 
FOR DELETE 
TO authenticated
USING (auth.uid()::text = "from" OR auth.uid()::text = "to");