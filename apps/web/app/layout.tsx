import type { Metadata } from "next";
import { Quicksand } from "next/font/google";
import "./globals.css";

const quicksand = Quicksand({
  variable: "--font-quicksand",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "MOOVIA · Velocity-based Training",
  description: "Track your weightlifting performance with velocity-based training metrics",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${quicksand.variable} font-[var(--font-quicksand)] bg-[#05060A] text-slate-100 min-h-screen antialiased`}
      >
        <div className="max-w-md mx-auto flex flex-col min-h-screen">
          {children}
        </div>
      </body>
    </html>
  );
}
