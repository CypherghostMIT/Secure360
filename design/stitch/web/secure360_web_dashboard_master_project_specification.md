# Secure360 Web Dashboard — Master Project Context & Specification

## Executive Overview
**Secure360 Web Dashboard** is the centralized operational web console used by **Security First Cameroon (SFC)** SOC analysts and administrators in Cameroon (Central Africa / West Africa Time, WAT UTC+1) to receive, triage, assign, follow up on, and resolve cybersecurity incidents submitted by employees of client organizations (companies, public administrations, NGOs) via a dedicated mobile app.

Client IT managers can also log in to view and monitor telemetry strictly scoped to their own organization.

---

## Real-World Human Incident Taxonomy
Incidents are reported by **real people** (human-driven reporting, NOT automated machine ingestion or SIEM alert noise). Authentic incident examples:
- *"Fraudulent SMS pretending to be MTN MoMo"*
- *"Unauthorised Orange Money withdrawal"*
- *"Phishing e-mail with fake invoice"*
- *"Sudden loss of mobile network (suspected SIM swap)"*
- *"Computer very slow after opening an attachment"*
- *"WhatsApp business account takeover attempt"*
- *"Ransom note displayed after downloading invoice.pdf.exe"*

---

## Visual & Design System Tokens

### Style Philosophy
- **Aesthetic:** "Operational Enterprise / Classic SOC Enterprise" (clean, daylight enterprise feel; NOT dark sci-fi military cockpit).
- **Page Background:** `#F8F9FC`
- **Surface / Cards:** `#FFFFFF`
- **Borders & Dividers:** `#E0E0E0`
- **Primary Color:** `#003366` (SFC Deep Navy)
- **Primary Light / Subtle Tint:** `#E6F0FA`
- **Danger / Critical:** `#CC0000`
- **Success / Resolved:** `#006633`
- **Typography:** Inter (Clean geometric sans-serif)
  - Body: 14px Regular / Medium
  - Table Headers: 12px Semibold Uppercase, tracking-wider
  - Headings: 20px - 24px Bold
- **Geometry & Spacing:**
  - Sidebar: 240px wide, `#FFFFFF` white surface with right border `#E0E0E0`
  - Sticky Top Header: 64px tall, `#FFFFFF` background, border-b `#E0E0E0`
  - Content Max Width: 1248px centered or full-bleed responsive within grid
  - Page Content Padding: 24px
  - Table Row Height: 48px standard
  - Button Height: 40px standard with 6px border-radius (`rounded-[6px]`)

---

## Navigation & Layout Specifications

### 1. Left Sidebar (240px, White Surface)
Top: **SFC Secure360** brand lockup (reusing the official SFC logo asset `{{DATA:IMAGE:IMAGE_128}}`).
Items (strictly in this order):
1. **Queue** (Incoming triage queue with live incident badge counter)
2. **Incidents** (All incidents management and directory)
3. **Statistics** (Triage velocity, incident distribution across Cameroon)
4. **Reports** (Executive, compliance & client reporting exports)
5. **Organizations** (Client enterprises, public bodies, NGOs)
6. **Users** (Analysts, client IT managers, and mobile reporters)
7. **Audit log** (Immutable tracking of analyst assignments, status updates & notes)
8. **Settings** (Platform parameters, regional notification channels)

Bottom of Sidebar:
- Current logged-in user profile snippet: Circular avatar with initials, full name (e.g., *Rodrigue Essomba* or *Jean-Paul Nguemo*), role label (*SOC Tier 2 Analyst* or *SOC Admin*).

### 2. Sticky Header (64px)
- **Left:** Contextual Page Title & Breadcrumb trail (e.g., `Queue / Triage Stream`).
- **Right:**
  - Global search field (search by ticket ID `SFC-2026-XXXXXX`, organization name, or reporter).
  - Green pulse badge: **"● Live (WAT)"** indicator.
  - Notifications bell with unread badge counter.
  - **FR | EN** language switch toggle.
  - User quick menu / logout trigger.

---

## Statuses & Severities (Strict Standard)

### Severity Badges (Text + Background/Border/Text color)
- **Low:** `#006633` (Soft green tint: `bg-[#EAF5EE] text-[#006633] border-[#006633]/20`)
- **Moderate:** `#B26A00` (Warm amber tint: `bg-[#FEF5E7] text-[#B26A00] border-[#B26A00]/20`)
- **High:** `#D35400` (Vibrant orange tint: `bg-[#FDF0E7] text-[#D35400] border-[#D35400]/20`)
- **Critical:** `#CC0000` (Deep crimson tint: `bg-[#FDECEC] text-[#CC0000] border-[#CC0000]/20`)

### Status Badges (Strictly 5 Allowed Statuses)
1. **New:** `#003366` (`bg-[#E6F0FA] text-[#003366] border-[#003366]/20`)
2. **Assigned:** `#5B4B9A` (`bg-[#EFEBF7] text-[#5B4B9A] border-[#5B4B9A]/20`)
3. **In progress:** `#B26A00` (`bg-[#FEF5E7] text-[#B26A00] border-[#B26A00]/20`)
4. **Resolved:** `#006633` (`bg-[#EAF5EE] text-[#006633] border-[#006633]/20`)
5. **Closed:** `#666666` (`bg-[#F0F0F0] text-[#666666] border-[#CCCCCC]`)

*No other statuses are permitted.*

---

## Formats & Regional Standards
- **Ticket Reference Format:** `SFC-2026-001234`
- **Date Format:** `DD/MM/YYYY` (e.g., `14/10/2026`)
- **Time Format:** 24-hour clock (WAT - West Africa Time, UTC+1, e.g., `14:35 WAT`)

---

## Canonical Fictional Data to Reuse

### Analysts & Admins
- **Jean-Paul Nguemo** (Senior SOC Analyst, Tier 2)
- **Estelle Mbarga** (SOC Incident Responder)
- **Yannick Fotso** (SOC Triage Specialist)
- **Rodrigue Essomba** (SOC Administrator)

### Client Organizations
- **Kamdem Distribution SARL** (Type: *Company*, Location: *Douala*)
- **Office Régional des Archives du Centre** (Type: *Administration*, Location: *Yaoundé*)
- **ONG Santé Pour Tous** (Type: *NGO*, Location: *Bafoussam*)
- **Bamenda Agro Cooperative** (Type: *Company*, Location: *Bamenda*)
- **Garoua Transport Express** (Type: *Company*, Location: *Garoua*)

### Mobile App Reporters
- **Aimé Kamga**
- **Brice Etoundi**
- **Nadège Tchoua**
- **Samuel Njoya**
- **Grace Ayuk**

---

## Negative Constraints (Strictly Prohibited Items)
Never display:
- AI assistants or LLM copilot widgets
- Automated SIEM correlation engines
- MITRE ATT&CK matrix views
- STIX/TAXII threat feed terminology
- Automated SOAR playbooks / host isolation buttons
- FIDO2 / YubiKey hardware cryptographic references
- Okta / SCIM federated directory indicators
- Slack / PagerDuty integrations
- US / EU server regions (e.g., US-East-1, AWS KMS, etc.)
- DEFCON / military command terminology
- Demo / simulation fake buttons
