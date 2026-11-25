import "../../../globals.css";
import "./presenter.css";

export const metadata = { title: "Presenter · FestReady demo" };

export default function PresenterLayout({ children }: { children: React.ReactNode }) {
  return <div className="pres">{children}</div>;
}
