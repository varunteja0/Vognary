import LaunchLanding from "./launch-landing";

export const revalidate = 3600;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": "https://www.vognary.com/#software",
  name: "Vognary",
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Commitment Control",
  operatingSystem: "Web",
  url: "https://www.vognary.com/",
  description: "Vognary is Commitment Control: propose a spend, see cited exposure and policy, then a named human freezes a cap. Later receipts prove the outcome.",
  featureList: [
    "User-entered proposals labeled as assumptions",
    "Cited existing exposure and versioned policy",
    "Named human authorization with a frozen cap",
  ],
  provider: {
    "@type": "Organization",
    "@id": "https://www.vognary.com/#organization",
    name: "Vognary",
    url: "https://www.vognary.com/",
    email: "support@vognary.com",
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: "support@vognary.com",
        url: "https://www.vognary.com/contact",
        availableLanguage: ["English"],
      },
      {
        "@type": "ContactPoint",
        contactType: "security",
        email: "security@vognary.com",
        url: "https://www.vognary.com/.well-known/security.txt",
        availableLanguage: ["English"],
      },
    ],
    address: {
      "@type": "PostalAddress",
      addressCountry: "IN",
    },
  },
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <LaunchLanding />
    </>
  );
}
