import "./store.css";

export const metadata = { title: "Marigold Lane · festive hampers" };

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return <div className="store">{children}</div>;
}
