import { AuthProvider, useAuth } from '@/lib/auth';
import { RouterProvider, useRouter } from '@/lib/router';
import { AppShell } from '@/components/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { EmployeesPage } from '@/pages/EmployeesPage';
import { TasksPage } from '@/pages/TasksPage';
import { PunchesPage } from '@/pages/PunchesPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { ExceptionsPage } from '@/pages/ExceptionsPage';
import { SettingsPage } from '@/pages/SettingsPage';

function CurrentPage() {
  const { route } = useRouter();
  switch (route.name) {
    case 'dashboard':
      return <DashboardPage />;
    case 'employees':
      return <EmployeesPage />;
    case 'tasks':
      return <TasksPage />;
    case 'punches':
      return <PunchesPage />;
    case 'exceptions':
      return <ExceptionsPage />;
    case 'reports':
      return <ReportsPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <DashboardPage />;
  }
}

function AppContent() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <AppShell>
      <CurrentPage />
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider>
        <AppContent />
      </RouterProvider>
    </AuthProvider>
  );
}
