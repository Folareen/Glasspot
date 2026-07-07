import { BottomNav } from "./BottomNav";
import { Sidebar } from "./Sidebar";

type AppShellProps = {
  children: React.ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <Sidebar />
      <main className="flex-1 pb-20 lg:pb-0 lg:pl-64">{children}</main>
      <BottomNav />
    </div>
  );
}
