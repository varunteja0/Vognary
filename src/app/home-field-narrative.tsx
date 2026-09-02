"use client";

import { useEffect, useRef, useState } from "react";
import { AuthorityField } from "./authority-field";
import { authorityFieldSequence, type AuthorityFieldStage } from "@/lib/authority-field";

/**
 * Home's narrative.
 *
 * One field, five scenes. The field is sticky and the scenes move past it, so
 * the reader watches a single record change state rather than reading five
 * sections about a record. Scroll is never hijacked: the page scrolls normally
 * and an observer simply reports which scene is in front.
 */

const SCENES: readonly { stage: AuthorityFieldStage; question: string; heading: string; body: string }[] = [
  {
    stage: "EVIDENCE",
    question: "What can you already prove?",
    heading: "Two invoices. That is the whole of what is certain.",
    body:
      "Your record proves what a vendor has charged you before. It proves nothing about what they are about to charge you. Everything above that line is somebody's expectation.",
  },
  {
    stage: "PROPOSED",
    question: "What is actually being asked for?",
    heading: "A request is an unsettled region, not a number.",
    body:
      "Someone asks to raise a tier before a launch. The amount is typed, not proven, and the real charge could land anywhere between what you know and what was asked. Until a person decides, nothing about it is settled.",
  },
  {
    stage: "POLICY",
    question: "What can a rule do here?",
    heading: "Policy marks the region. It cannot close it.",
    body:
      "A deterministic rule can say this crosses your per-charge ceiling and your thirteen-week ceiling. That is a marking, not an answer. Vognary will not turn a rule into an approval, and it will not turn one into a refusal either.",
  },
  {
    stage: "AUTHORIZED",
    question: "What exactly becomes committed?",
    heading: "One named person collapses it to one boundary.",
    body:
      "A founder or admin decides, and the region becomes a line with their name and the time on it. That boundary is written once. No later receipt, correction or argument moves it.",
  },
  {
    stage: "OBSERVED",
    question: "How do you find out what really happened?",
    heading: "The receipt arrives and lands somewhere.",
    body:
      "Later evidence enters from outside the decision and is measured against the boundary that already existed. Here it lands above. The record shows the overrun without rewriting the authorization that preceded it.",
  },
];

export function HomeFieldNarrative({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(-1);
  const scenes = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const nodes = scenes.current.filter((node): node is HTMLElement => node !== null);
    if (!nodes.length) return;

    // The scene in front is the one crossing the reader's anchor line. On a
    // phone the field is pinned across the top, so the anchor sits low in the
    // remaining space; on a desktop the field is beside the copy and the anchor
    // is centred. Nearest-to-anchor is deterministic — taking whichever entry an
    // IntersectionObserver reported last is not, and produced a different stage
    // depending on scroll speed.
    let frame = 0;
    const pick = () => {
      frame = 0;
      const anchor = window.innerHeight * (matchMedia("(min-width: 64rem)").matches ? 0.5 : 0.78);
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      nodes.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        const distance = rect.top > anchor
          ? rect.top - anchor
          : rect.bottom < anchor
            ? anchor - rect.bottom
            : 0;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      setActive(best);
    };

    // One rect read per scene per animation frame, and only while a frame is
    // pending, so a fast scroll never queues work it cannot use.
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(pick);
    };

    pick();

    // Correctness comes from the observer, not from scroll events: a throttled
    // or backgrounded tab stops delivering scroll and animation frames, but
    // intersection callbacks still arrive, so the field cannot silently stop
    // advancing. The scroll listener only makes the change feel immediate while
    // frames are available.
    const observer = new IntersectionObserver(pick, {
      threshold: [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1],
    });
    for (const node of nodes) observer.observe(node);

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  // The first frame is already useful: the field opens on proven evidence, the
  // one thing that is true before anybody asks for anything.
  const stage = SCENES[active]?.stage ?? authorityFieldSequence[0];

  return (
    <div className="home-stage">
      <div className="home-stage-copy">
        {children}
        <ol className="home-scenes">
          {SCENES.map((scene, index) => (
            <li
              key={scene.stage}
              data-scene={index}
              data-active={index === active ? "true" : "false"}
              ref={(node) => {
                scenes.current[index] = node;
              }}
            >
              <p className="home-scene-question">{scene.question}</p>
              <h3 className="home-scene-heading font-display">{scene.heading}</h3>
              <p className="home-scene-body">{scene.body}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="home-field">
        <h2 id="home-field-heading" className="sr-only">
          One commitment, from proven history to reconciled outcome
        </h2>
        <AuthorityField stage={stage} branch="APPROVE_WITH_CAP" labelledBy="home-field-heading" />
      </div>
    </div>
  );
}
