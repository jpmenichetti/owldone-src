import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { I18nProvider } from "@/i18n/I18nContext";
import { SimulatedTimeProvider } from "@/hooks/useSimulatedTime";
import { FeatureAccessProvider } from "@/hooks/useFeatureAccess";
import { WorkspaceProvider } from "@/hooks/useWorkspaces";
import Index from "./pages/Index";
import Admin from "./pages/Admin";
import IosAuthCallback from "./pages/IosAuthCallback";
import OAuthConsent from "./pages/OAuthConsent";
import NotFound from "./pages/NotFound";


const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <FeatureAccessProvider>
        <WorkspaceProvider>
          <I18nProvider>
            <SimulatedTimeProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <BrowserRouter>
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/admin" element={<Admin />} />
                  <Route path="/auth/ios-callback" element={<IosAuthCallback />} />
                  <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </BrowserRouter>
            </TooltipProvider>
            </SimulatedTimeProvider>
          </I18nProvider>
        </WorkspaceProvider>
      </FeatureAccessProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
