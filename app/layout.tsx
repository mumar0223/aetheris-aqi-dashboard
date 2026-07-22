import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AETHERIS — AI Urban Air Quality Intelligence Platform",
  description:
    "AI-powered geospatial air quality intelligence for smart city intervention. " +
    "Real-time AQI monitoring, hyperlocal forecasting, source attribution, " +
    "enforcement route optimization, and citizen health advisory system " +
    "across Indian metros. Built for NCAP compliance.",
  keywords: [
    "air quality", "AQI", "smart city", "pollution", "India",
    "geospatial", "AI", "forecasting", "NCAP", "CPCB",
  ],
};

import QueryProvider from "../components/QueryProvider";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Font Awesome Icons */}
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
