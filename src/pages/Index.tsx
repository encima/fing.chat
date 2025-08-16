import { useAuth } from "@/hooks/useAuth";
import AuthPage from "@/components/auth/AuthPage";
import ChatInterface from "@/components/chat/ChatInterface";

const Index = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-chat">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return user ? <ChatInterface /> : <AuthPage />;
};

export default Index;
