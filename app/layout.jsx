import "./globals.css";
import Nav from "@/components/Nav";
import CreatorNotes from "@/components/CreatorNotes";
import { RoleProvider } from "@/components/RoleProvider";

export const metadata = {
  title: "Live Brand Check",
  description: "Check posts against brand guidelines, approved facts and Indian ad rules before publishing.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" rel="stylesheet" />
      </head>
      <body>
        <RoleProvider>
          <Nav />
          <CreatorNotes />
          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-muted">
            Demo data is fictional. Post images are read in your browser; only a small preview is saved so reviewers can see the post. Posts are checked with fixed rules
            and your approved facts, not AI. Brand kit PDFs may be read with an AI service if one is configured; every item is confirmed by a person.
          </footer>
        </RoleProvider>
      </body>
    </html>
  );
}
