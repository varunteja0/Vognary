import "./ledger.css";
import type { ReactNode } from "react";

export type PublicDocumentSection = {
  title: string;
  body: ReactNode;
};

export function PublicDocument({
  folio,
  title,
  effectiveDate,
  summary,
  idPrefix,
  sections,
}: {
  folio: string;
  title: string;
  effectiveDate: string;
  summary: string;
  idPrefix: string;
  sections: readonly PublicDocumentSection[];
}) {
  return (
    <article className="public-ledger">
      <header className="public-ledger-rail">
        <span className="folio" data-folio="Trust">{folio}</span>
        <h1 className="mt-5 font-display text-4xl font-semibold leading-tight text-(--ink) sm:text-5xl">{title}</h1>
        <p className="mt-4 font-data text-xs text-(--muted)">EFFECTIVE {effectiveDate.toUpperCase()}</p>
        <p className="mt-5 text-sm leading-7 text-(--ink-soft)">{summary}</p>
        <details className="public-index mt-6" open>
          <summary>In this document</summary>
          <ol>
            {sections.map((section, index) => (
              <li key={section.title}>
                <a href={`#${idPrefix}-${index + 1}`}>{section.title}</a>
              </li>
            ))}
          </ol>
        </details>
      </header>

      <div className="public-ledger-body">
        {sections.map((section, index) => (
          <section
            id={`${idPrefix}-${index + 1}`}
            key={section.title}
            className={`public-band scroll-mt-6 ${index === 0 ? "public-band-lead" : ""}`}
          >
            <h2 className="font-display text-xl font-semibold text-(--ink)">{section.title}</h2>
            <div className="mt-3 max-w-3xl text-sm leading-7 text-(--muted)">{section.body}</div>
          </section>
        ))}
      </div>
    </article>
  );
}