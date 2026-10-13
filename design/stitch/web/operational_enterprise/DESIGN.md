---
name: Operational Enterprise
colors:
  surface: '#ffffff'
  surface-dim: '#dcd9d9'
  surface-bright: '#fcf9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f2'
  surface-container: '#f0eded'
  surface-container-high: '#eae7e7'
  surface-container-highest: '#e5e2e1'
  on-surface: '#1b1b1c'
  on-surface-variant: '#43474f'
  inverse-surface: '#303030'
  inverse-on-surface: '#f3f0ef'
  outline: '#737780'
  outline-variant: '#c3c6d1'
  surface-tint: '#3a5f94'
  primary: '#001e40'
  on-primary: '#ffffff'
  primary-container: '#003366'
  on-primary-container: '#799dd6'
  inverse-primary: '#a7c8ff'
  secondary: '#566068'
  on-secondary: '#ffffff'
  secondary-container: '#dae4ee'
  on-secondary-container: '#5c666e'
  tertiary: '#381300'
  on-tertiary: '#ffffff'
  tertiary-container: '#592300'
  on-tertiary-container: '#d8885c'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d5e3ff'
  primary-fixed-dim: '#a7c8ff'
  on-primary-fixed: '#001b3c'
  on-primary-fixed-variant: '#1f477b'
  secondary-fixed: '#dae4ee'
  secondary-fixed-dim: '#bec8d1'
  on-secondary-fixed: '#131d24'
  on-secondary-fixed-variant: '#3e4850'
  tertiary-fixed: '#ffdbca'
  tertiary-fixed-dim: '#ffb690'
  on-tertiary-fixed: '#341100'
  on-tertiary-fixed-variant: '#723610'
  background: '#f8f9fc'
  on-background: '#1b1b1c'
  surface-variant: '#e5e2e1'
  danger: '#cc0000'
  success: '#006633'
  text-primary: '#1e1e1e'
  text-secondary: '#666666'
  border: '#e0e0e0'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  caption:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-table-header:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.5rem
  margin: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.25rem
  space-xl: 1.5rem
---

# Design System Specifications: SFC Web Design System

## Brand Identity & Aesthetic
A structured, reliable, enterprise-grade design system tailored for operational clarity, administrative dashboards, and data-dense web applications. Emphasizes clean surfaces, strict contrast ratios, and deliberate spacing.

## Color Palette
- **Primary**: `#003366` (SFC Blue - Brand primary, main CTA, active navigation, key accents)
- **Primary Light**: `#e6f0fa` (SFC Light Blue - Selected states, subtle pill badges, hover backgrounds)
- **Danger**: `#cc0000` (SFC Red - Destructive actions, error badges, critical alerts)
- **Success**: `#006633` (SFC Green - Confirmation states, success badges, positive metrics)
- **Background**: `#f8f9fc` (Light Gray - Main app canvas background)
- **Surface**: `#ffffff` (White - Cards, tables, modals, sidebars, header surfaces)
- **Text Primary**: `#1e1e1e` (High contrast body text, headlines, dark labels)
- **Text Secondary**: `#666666` (Muted labels, metadata, secondary captions)
- **Border**: `#e0e0e0` (Dividers, card outlines, table borders, form field outlines)

## Typography
- **Font Family**: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif
- **H1**: 28px, font-weight 700 (Bold), line-height 36px
- **H2**: 24px, font-weight 700 (Bold), line-height 32px
- **H3**: 20px, font-weight 600 (Semibold), line-height 28px
- **Body**: 14px, font-weight 400 (Regular), line-height 20px
- **Body Small**: 13px, font-weight 400 (Regular), line-height 18px
- **Caption**: 12px, font-weight 400 (Regular), line-height 16px
- **Table Header**: 12px, font-weight 600 (Semibold), text-transform uppercase, letter-spacing 0.05em

## Spacing & Metrics
- **Page Padding**: 24px
- **Card Padding**: 20px
- **Table Row Height**: 48px
- **Form Group Spacing**: 20px
- **Button Height**: 40px (padding: 0 16px, border-radius: 6px)

## Layout & Architecture
- **Sidebar Width**: 240px expanded, 64px collapsed
- **Header Height**: 64px tall (sticky top, surface white with bottom border #e0e0e0)
- **Max Content Width**: 1248px
- **Grid System**: 12-column responsive layout with 24px gutters
