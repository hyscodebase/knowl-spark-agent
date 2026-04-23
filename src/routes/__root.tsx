import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/lib/auth";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Smart Local Knowledge Agent | 로컬 문서 지식 에이전트" },
      {
        name: "description",
        content:
          "PDF, DOCX, PPTX, TXT 문서를 업로드하고 멀티 에이전트 RAG 파이프라인으로 의미 기반 검색과 근거 있는 답변을 받으세요.",
      },
      { name: "author", content: "Smart Knowledge Agent" },
      { property: "og:title", content: "Smart Local Knowledge Agent | 로컬 문서 지식 에이전트" },
      {
        property: "og:description",
        content: "로컬 문서를 위한 멀티 에이전트 RAG 시스템.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Smart Local Knowledge Agent | 로컬 문서 지식 에이전트" },
      { name: "description", content: "AI 에이전트가 로컬 문서를 이해하고 의미론적 검색 및 요약 기능을 제공합니다." },
      { property: "og:description", content: "AI 에이전트가 로컬 문서를 이해하고 의미론적 검색 및 요약 기능을 제공합니다." },
      { name: "twitter:description", content: "AI 에이전트가 로컬 문서를 이해하고 의미론적 검색 및 요약 기능을 제공합니다." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/f1ae2b3a-ecbc-4628-ae38-88b9389c0936/id-preview-c51b6dfb--3ed644a9-34e5-4689-9710-5560584a24d3.lovable.app-1776833562425.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/f1ae2b3a-ecbc-4628-ae38-88b9389c0936/id-preview-c51b6dfb--3ed644a9-34e5-4689-9710-5560584a24d3.lovable.app-1776833562425.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <AuthProvider>
      <Outlet />
      <Toaster richColors position="top-center" />
    </AuthProvider>
  );
}
