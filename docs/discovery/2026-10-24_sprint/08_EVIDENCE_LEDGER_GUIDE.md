# Evidence ledger guide

The CSV next to this file has a header and no rows. Do not add an example row. An example becomes a fake interview the moment someone counts it.

One completed approver conversation, one row, written the same day. Advisers, investors, and friends get no row, or a row whose `verified_approver` is `no`. Those rows do not count toward the five.

## Columns

| Column | What to write |
| --- | --- |
| date | `YYYY-MM-DD` of the call |
| organisation_or_anonymous_id | Company name only if your notes are private. If this file might be committed, use `C1`, `C2`, and keep the name in a private note. Default for a git commit: anonymous id |
| role | Their job, not a guessed seniority |
| verified_approver | `yes` only if they approve the model, API, or cloud commitment. Otherwise `no` or `unclear` |
| company_size_evidence | What they said, or the public source, with the conflict if any |
| ai_api_cloud_spend_evidence | A range they volunteered, or `not disclosed`. Never a copied invoice |
| last_real_commitment | One sentence: what, roughly when, why |
| current_workflow_tools | The named tools |
| enforced_vs_alert_vs_report | `hard_block`, `alert`, `report`, `nothing`, or `unclear`, plus the product name |
| pre_commitment_pain | `yes`, `no`, or `unclear`. `yes` only if the painful moment is before the commitment, in their words |
| frequency | Their words |
| quantified_impact_if_volunteered | Blank if they did not offer a figure |
| permissioned_quote | One or two short sentences you could show them. No secrets |
| interpretation | Your inference, labelled as such in the cell if needed. Do not put it in the quote column |
| alternatives_named | Sheet, provider limit, card, accountant, "nothing" |
| reaction_to_concept | What they said after section C, or `not discussed` |
| price_reaction_inr_14999 | Their number, or `high`, `plausible`, `irrelevant`, or `not discussed`. Do not write `yes` because they nodded |
| willing_pilot_conversation_after_data_boundary | `yes` only with a specific next step after you explained that real bills are blocked. Otherwise `no` |
| next_action | One verb. `none` is allowed |
| score_0_to_3 | See below |

## Score

The score does not override the gate. It only stops a vague "good call" from looking like evidence.

| Score | Meaning |
| --- | --- |
| 0 | No concrete incident, or they are not the approver |
| 1 | A real workflow, and the current tools are enough, or the pain is only after the bill |
| 2 | A repeated pre-commitment gap, and they did not ask for a hard block as the only fix |
| 3 | Score 2, plus a price reaction that treats ₹14,999 as plausible or names another number they would pay, plus a specific next conversation |

A 3 still does not count as a pilot sale.

## What never goes in the file

Card numbers, invoice PDFs, OTPs, bank details, customer names of *their* customers, or a quote they asked you not to keep. If the only evidence is sensitive, write "impact described, not recorded" and keep the classification.

## Counting for the gate

Count a row toward the five only when `verified_approver` is `yes` and `last_real_commitment` is not blank. Count it toward the three only when `pre_commitment_pain` is `yes`. Count it toward the two only when `price_reaction_inr_14999` is a number, `plausible`, or an explicit discussion of that price rather than `not discussed`. Count it toward the one only when `willing_pilot_conversation_after_data_boundary` is `yes`.
