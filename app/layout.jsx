import "./globals.css";
import Shell from "@/components/Shell";
import { RoleProvider } from "@/components/RoleProvider";
import { THEME_SCRIPT } from "@/components/Theme";

export const metadata = {
  title: "Live Brand Check",
  description: "Check posts against brand guidelines, approved facts and Indian ad rules before publishing.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the saved light/dark theme before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <RoleProvider>
          <Shell>{children}</Shell>
        </RoleProvider>
      </body>
    </html>
  );
}
