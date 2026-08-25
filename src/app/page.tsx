import LaunchLanding from "./launch-landing";

export const revalidate = 3600;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": "https://www.vognary.com/#software",
  name: "Vognary",
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Commitment Intelligence",
  operatingSystem: "Web",
  url: "https://www.vognary.com/",
  description: "Vognary turns software bills into cited commitments, upcoming charges, changes, and conservative renewal decisions for founder-led software and AI companies.",
  featureList: [
    "Cited recurring vendor commitments from user-provided billing evidence",
    "Upcoming charge and price-change review",
    "Keep, Review later, and Plan to cancel decisions",
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
