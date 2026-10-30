import StartupLoader from "@/components/StartupLoader";

export default function WriteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StartupLoader />
      {children}
    </>
  );
}
