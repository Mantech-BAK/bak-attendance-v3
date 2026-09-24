import { AuthProvider, useAuth } from '@/lib/auth';
import { RouterProvider, useRouter } from '@/lib/router';
import { AppShell } from '@/components/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { EmployeesPage } from '@/pages/EmployeesPage';
import { EditEmployeePage } from '@/pages/EditEmployeePage';
import { TasksPage } from '@/pages/TasksPage';
import { PunchesPage } from '@/pages/PunchesPage';
import { ApprovalsPage } from '@/pages/ApprovalsPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { ExceptionsPage } from '@/pages/ExceptionsPage';
import { ReportedLeavesPage } from '@/pages/ReportedLeavesPage';
import { SettingsPage } from '@/pages/SettingsPage';

function CurrentPage() {
  const { route } = useRouter();
  switch (route.name) {
    case 'dashboard':
      return <DashboardPage />;
    case 'employees':
      return <EmployeesPage />;
    case 'employee-edit':
      return route.empId ? <EditEmployeePage empId={route.empId} /> : <EmployeesPage />;
    case 'tasks':
      return <TasksPage />;
    case 'punches':
      return <PunchesPage />;
    case 'approvals':
      return <ApprovalsPage />;
    case 'projects':
      return <ProjectsPage />;
    case 'exceptions':
      return <ExceptionsPage />;
    case 'reported-leaves':
      return <ReportedLeavesPage />;
    case 'reports':
      return <ReportsPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <DashboardPage />;
  }
}

function AppContent() {
  const { isAuthenticated, isInitializing } = useAuth();

  // Neither logged-in nor logged-out yet — just checking localStorage for
  // an existing session (see auth.tsx's isInitializing comment). A brief,
  // obviously-a-spinner beat here reads as "loading"; falling through to
  // LoginPage instead (the previous behavior) reads as "got logged out" or
  // "stuck", even when the real session shows up moments later.
  if (isInitializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-teal-600" />
      </div>
    );
  }

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
