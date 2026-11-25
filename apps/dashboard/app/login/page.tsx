import "../globals.css";
import Login from "@/components/Login";

export const metadata = { title: "Log in · FestReady ops" };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <Login next={next} />;
}
