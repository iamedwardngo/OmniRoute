import { source } from "@/lib/source";
import { DocsPage, DocsBody } from "fumadocs-ui/layouts/docs/page";
import { notFound } from "next/navigation";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE } from "@/i18n/config";
import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window as unknown as Window);

// ── Locale detection ────────────────────────────────────────────────────────

function getDocsLocale(): string {
  try {
    const cookieStore = cookies();
    return (cookieStore as any).get(LOCALE_COOKIE)?.value || DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

// ── i18n fallback ───────────────────────────────────────────────────────────
// When locale ≠ "en", try to load the translated .md from
// `docs/i18n/<locale>/docs/<section>/<FILE>.md` — the exact path layout that
// `scripts/i18n/run-translation.mjs` produces. Returns rendered HTML or null.

export function tryI18nFallback(slug: string[], locale: string): string | null {
  // SECURITY: Prevent path traversal by sanitizing locale/slug and verifying
  // the resolved path remains within the docs/i18n root. HTML output is
  // sanitized via DOMPurify to prevent XSS from malicious markdown content.
  if (!locale || locale === "en") return null;

  // 1. Sanitize locale: only alphanumeric and hyphens allowed (e.g. "pt-BR")
  if (!/^[a-z0-9-]+$/i.test(locale)) return null;

  // 2. Resolve the base directory for i18n docs
  const docsRoot = path.resolve(process.cwd(), "docs");
  const i18nRoot = path.join(docsRoot, "i18n");

  // 3. Sanitize and construct the section directory path
  // Remove any path traversal segments from the slug
  const safeSlug = slug.filter((segment) => segment !== ".." && segment !== ".");
  const sectionDir = path.join(i18nRoot, locale, "docs", ...safeSlug.slice(0, -1));

  // 4. Defense-in-depth: Ensure the resolved sectionDir is still within i18nRoot
  if (!path.resolve(sectionDir).startsWith(i18nRoot)) return null;

  if (!fs.existsSync(sectionDir)) return null;

  // Fumadocs lowercases slugs — match case-insensitively against i18n dir
  const target = safeSlug[safeSlug.length - 1];
  if (!target) return null;

  let files: string[];
  try {
    files = fs.readdirSync(sectionDir);
  } catch {
    return null;
  }

  const match = files.find((f) => f.toLowerCase().replace(/\.md$/, "") === target.toLowerCase());
  if (!match) return null;

  const filePath = path.join(sectionDir, match);

  // 5. Final safety check: ensure the actual file is still within i18nRoot
  if (!path.resolve(filePath).startsWith(i18nRoot)) return null;

  const raw = fs.readFileSync(filePath, "utf8");

  // Strip the i18n header (heading + language bar + ---) before rendering.
  // Translated files have: # Title (Native)\n\n🌐 Languages: ...\n\n---\n\nbody
  const bodyMatch = raw.match(/^---\s*$/m);
  const body =
    bodyMatch && bodyMatch.index != null
      ? raw.slice(bodyMatch.index + bodyMatch[0].length).trim()
      : raw;

  const html = marked.parse(body) as string;

  // 6. Sanitize the HTML for defense-in-depth against XSS
  return DOMPurify.sanitize(html);
}

// ── Page component ──────────────────────────────────────────────────────────

export default async function Page(props: { params: Promise<{ slug: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const locale = getDocsLocale();
  const i18nHtml = tryI18nFallback(params.slug, locale);

  if (i18nHtml) {
    // Render translated markdown (non-English locale with available translation)
    return (
      <DocsPage toc={page.data.toc} full={page.data.full}>
        <DocsBody>
          <div className="prose-content" dangerouslySetInnerHTML={{ __html: i18nHtml }} />
        </DocsBody>
      </DocsPage>
    );
  }

  // Default: English MDX rendered natively by Fumadocs
  const MDX = page.data.body;
  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsBody>
        <MDX components={{ ...defaultMdxComponents }} />
      </DocsBody>
    </DocsPage>
  );
}

// ── Static params & metadata ────────────────────────────────────────────────

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) return {};

  return {
    title: `${page.data.title} — OmniRoute Docs`,
    description: page.data.description ?? `OmniRoute documentation: ${page.data.title}`,
  };
}
