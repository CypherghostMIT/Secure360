# Secure360 Product & Design Context — Security First Cameroon (SFC)

## Product Identity & Target Audience
- **App Name**: Secure360 (Subtitle: "by Security First Cameroon")
- **Operator**: Security First Cameroon (SFC)
- **Target Users**: Non-technical employees of small & medium enterprises and public administrations across Cameroon (salespeople, executive secretaries, accountants, general managers, field staff).
- **Tone & Voice**: Calm, reassuring, human, plain everyday language, short clear sentences, zero blame, empathetic. **Strictly no technical jargon.**
- **Contextual Incident Types**: Fraudulent SMS, Mobile Money fraud (Orange Money / MTN MoMo scams), phishing emails, strange computer behavior / screen freezes, unexpected network loss / SIM swap.

## Negative Constraints (Strict Exclusions)
- **NEVER SHOW**: AI assistants or bots, SIEM, PCAP, MITRE, IP addresses, "end-to-end encrypted" tech badges, US regions (US-East/Frankfurt), US companies, server node names, CLI code blocks, hacker/cyber-warfare terminology.

## Localization & Realistic Context (Cameroon)
- **Names**: Cameroonian names and organisations (e.g., Douala Logistics SARL, Yaoundé Microfinance, Paul Nguema, Amina Bello, Jean-Pierre Fotso).
- **Phone Numbers**: Cameroonian format (+237 6XX XX XX XX / +237 2XX XX XX XX).
- **Dates & Time**: Format `DD/MM/YYYY`, 24-hour time notation (e.g. `14:35`).
- **Incident References**: Formatted as `SFC-2026-001234`.
- **Currency (if applicable)**: FCFA / XAF.

## Visual Tokens & Design System ("SFC Enterprise")
- **Primary**: `#003366` (SFC Blue)
- **Primary Light**: `#E6F0FA`
- **Danger**: `#CC0000`
- **Success**: `#006633`
- **Background**: `#F8F9FC`
- **Cards**: Pure White `#FFFFFF`, border `1px solid #E0E0E0`, border-radius `8px` (`rounded-lg`).
- **Text**: Primary `#1E1E1E`, Secondary `#666666`.
- **Typography**: System sans-serif (Roboto / Inter).
  - H1: 24px bold
  - H2: 20px bold
  - Body: 16px regular
  - Small: 14px regular
  - Caption: 12px regular
- **Layout**: 16px screen padding, 48px minimum touch targets, Mobile viewport (390 × 844 px).
- **Severity Badges (Text + Colour)**:
  - Low: `#006633` (Green)
  - Moderate: `#B26A00` (Amber)
  - High: `#D35400` (Orange)
  - Critical: `#CC0000` (Red)
- **Status Badges (Text + Colour)**:
  - Received: `#003366`
  - Assigned: `#5B4B9A`
  - In progress: `#B26A00`
  - Resolved: `#006633`
  - Closed: `#666666`
- **Bottom Navigation (4 fixed tabs)**:
  - 1. Home
  - 2. My incidents
  - 3. Notifications
  - 4. Profile
