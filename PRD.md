# Billion Views PRD

## 1. Overview
`Billion Views` is a creator analytics and UGC campaign operations platform for brands, app marketers, and growth teams running short-form creator programs.

The product uses a connected external data provider as the primary source for creator, video, and performance data. Our app's main purpose is to display, organize, and operationalize that data in the workflow and UI we actually want.

The core product hierarchy should be:
1. organization
2. campaign
3. creators and videos inside each campaign

The product is designed to help operators:
- discover and save creators
- track creator accounts and short-form videos across TikTok, Instagram Reels, and YouTube Shorts
- organize creators into campaigns
- manage outreach, deal flow, deliverables, and payouts
- analyze performance trends and campaign ROI from one dashboard

This is not a consumer social app. It is an internal team tool for performance marketing and influencer/UGC operations.

For MVP, the primary navigation and data model should revolve around organizations that contain campaigns, with each campaign serving as the main place where users review creators, videos, notes, statuses, and payouts.

## 2. Product Vision
Build the best internal operating layer on top of synced creator data for short-form creator acquisition.

Teams should be able to go from:
1. finding a creator
2. deciding whether they are a fit
3. contacting and managing them
4. tracking delivered content
5. measuring output and ROI

...without bouncing across spreadsheets, notes, screenshots, and multiple tools.

## 3. Problem
Today, even with access to creator data through external providers, teams still manage execution with a messy stack:
- spreadsheets for creator lists and campaign tracking
- separate tools for notes and collaboration
- screenshots or ad hoc proofs of content delivery
- disconnected payout tracking
- internal dashboards that do not match the actual operator workflow

This creates major pain:
- hard to turn raw creator data into an opinionated workflow
- difficult to compare creators and content in the exact views the team wants
- no centralized view that combines analytics with internal campaign operations
- weak campaign tracking from outreach to payout
- poor visibility into what content styles actually work
- too much manual work moving between analytics and execution tools

## 4. Target Users
### Primary users
- app marketers running performance-based creator acquisition
- DTC/ecommerce brands running influencer and UGC programs
- agencies managing creators or campaigns for clients
- in-house growth teams managing large creator pipelines

### User types
- Growth Lead: wants ROI visibility, campaign performance, and team accountability
- Creator Manager: wants smooth outreach, deal tracking, and creator organization
- Analyst: wants dashboards, trend analysis, and benchmarking
- Operator/Coordinator: wants fast workflows for updating statuses, notes, and payouts

## 5. Core Jobs To Be Done
- "Help me maintain a clean database of creators we care about."
- "Help me quickly see which creators and videos are performing."
- "Help me manage campaign workflow from outreach to completed payout."
- "Help me understand which content formats, niches, and creators drive results."
- "Help my team collaborate without relying on spreadsheets."

## 6. Value Proposition
`Billion Views` turns connected creator data into a custom internal operating system for creator teams, combining analytics, campaign workflow, notes, and payouts in one UI so operators can move faster and manage campaigns the way they actually work.

## 7. MVP Scope
The MVP should focus on a clean operator workflow and deliver immediate value for teams already getting creator data from an external provider.

### MVP goals
- support organization-based accounts with Google authentication
- sync and display creator/account/video data from the connected data provider
- save creator profiles into an internal database layered on top of provider-synced data
- display creators and videos inside campaign contexts
- view recent short-form content per creator
- track performance metrics over time using the connected data source
- group creators into campaigns
- manage creator statuses, notes, deliverables, and payouts
- review performance through a dashboard

### Out of scope for MVP
- email/password auth
- building our own creator scraping or platform data ingestion pipeline
- automated outbound messaging inside the app
- creator-side portal
- contract generation/e-signing
- deep attribution or MMP integrations
- AI-generated creative recommendations beyond basic insights
- social posting or scheduling
- consumer-facing social feed features

## 8. Key Modules
### 8.1 Creator Database
Creators should belong to an organization and be attachable to one or more campaigns.

Users can store and organize creators with:
- name / handle
- platform
- profile URL
- niche/category tags
- region/language
- follower count
- average views
- average engagement
- contact info if available
- internal notes
- custom tags
- creator status

Core actions:
- sync/import creator from the connected data source
- enrich creator with internal fields
- search creators
- filter by niche, platform, status, performance, campaign
- save creators to campaigns
- review creators from within a campaign as the default workflow

### 8.2 Creator Profile Pages
Each creator gets a dedicated profile page showing:
- profile summary
- linked platforms
- recent videos
- performance trends
- campaign memberships
- notes and activity history
- deal status
- payout summary

### 8.3 Video Tracking
Users should be able to track recent short-form videos for each creator, with campaign-level views being the main UX:
- video URL
- platform
- publish date
- views
- likes
- comments
- estimated engagement rate
- caption/title
- content tags or hooks
- campaign association

The app should support:
- recent video feed by creator
- recent video feed by campaign
- platform-specific filtering
- trend charts over time
- identification of top-performing videos
- clear separation between synced source fields and internal team-managed fields when needed

### 8.4 Campaign Pipeline
Campaigns are the main working unit inside an organization. Each campaign should act as the home for the creators, videos, notes, statuses, and payouts associated with that initiative.

Each campaign should support:
- organization
- campaign name
- owner
- status
- start/end date
- budget
- target KPIs
- creators assigned
- notes

Per creator in a campaign:
- outreach status
- negotiation status
- content due date
- content delivered date
- approval status
- posting status
- payout status
- agreed payout
- internal notes

Suggested default statuses:
- lead
- contacted
- negotiating
- agreed
- content due
- content received
- posted
- paid
- closed

### 8.5 Payout Tracking
The app should let teams track:
- agreed rate
- actual payout
- payout status
- payout date
- payment method
- creator-level spend
- campaign-level spend totals

### 8.6 Analytics Dashboard
Dashboard should provide:
- total creators tracked
- creators added this period
- total videos tracked
- total campaign spend
- average views by creator/campaign/platform
- top creators by recent performance
- top videos by views or engagement
- posting frequency trends
- campaign delivery progress
- ROI input/output summary

### 8.7 Filters and Search
Global filtering should support:
- platform
- niche
- campaign
- creator status
- outreach/deal/payout status
- follower bands
- average views
- recent posting activity
- geography/language

### 8.8 Organization Dashboard / Admin
The product should be organization-friendly:
- Google-authenticated access for team members
- shared creator database within an organization
- shared campaigns within an organization
- owner assignment
- activity visibility
- notes/history log
- role-based access later

## 9. Primary Information Architecture
The app structure should be opinionated and simple:
1. organization is the top-level container
2. campaigns live inside an organization
3. creators and videos are primarily viewed and managed inside campaigns

This means the main operator flow should not start from a giant global creator database. It should usually start with an organization, then a campaign, then the campaign's creators and videos.

## 10. Primary User Flows
### Flow 1: Add and qualify a creator
1. User signs in with Google and enters their organization.
2. User opens a campaign.
3. User selects or imports a creator from synced source data.
4. App creates or updates a local creator record and attaches it to the campaign.
5. App syncs recent content and account stats from the connected data source.
6. User tags the creator by niche, region, and campaign fit.
7. User saves notes and sets an initial status.

### Flow 2: Add creator to campaign
1. User opens an organization.
2. User opens a campaign.
3. User adds one or more creators.
4. User sets outreach/deal status.
5. User adds agreed payout and due dates.
6. User tracks delivery and posting progress.

### Flow 3: Review performance
1. User opens an organization dashboard or a campaign analytics page.
2. User filters by campaign/platform/date range.
3. User compares creators and top videos within the campaign.
4. User identifies what content styles are working.
5. User exports insights into next campaign decisions.

## 11. Core Screens
- Landing page / marketing site
- Google sign-in / onboarding
- Onboarding / setup checklist
- Organization selector
- Organization dashboard
- Campaign list
- Campaign detail page
- Campaign creators tab
- Campaign videos tab
- Creator profile page
- Payout tracker
- Global search / filters
- Settings / organization admin

## 12. Functional Requirements
### Must-have for MVP
- Google authentication
- organization creation / membership
- external data provider API integration
- data sync / caching layer for provider data
- organization-scoped campaign CRUD
- creator CRUD
- creator-to-campaign association
- campaign-level video views
- notes and tags
- recent video tracking per creator
- metrics snapshots over time
- dashboard charts
- payout status tracking
- filtering and sorting

### Nice-to-have after MVP
- bulk import
- CSV export
- alerts for new creator posts
- saved views/segments
- team roles and permissions
- attribution integrations
- benchmark scoring
- AI tagging for content themes

## 13. Data Model (First Pass)
### Core entities
- `users`
- `organizations`
- `organization_members`
- `creators`
- `creator_platform_accounts`
- `creator_metrics_snapshots`
- `campaigns`
- `campaign_creators`
- `videos`
- `video_metrics_snapshots`
- `notes`
- `tags`
- `creator_tags`
- `payouts`
- `activities`
- `sync_jobs`
- `source_mappings`

### Example entity notes
`creators`
- id
- organization_id
- display_name
- primary_niche
- region
- language
- internal_status
- notes_summary
- created_at
- updated_at

`campaigns`
- id
- organization_id
- name
- owner_user_id
- status
- budget
- start_date
- end_date
- created_at
- updated_at

`creator_platform_accounts`
- id
- creator_id
- platform
- source_account_id
- handle
- profile_url
- follower_count
- average_views
- average_engagement_rate
- last_synced_at

`videos`
- id
- creator_id
- creator_platform_account_id
- campaign_id nullable
- source_video_id
- platform
- video_url
- title_or_caption
- published_at
- views
- likes
- comments
- engagement_rate

`campaign_creators`
- id
- campaign_id
- creator_id
- outreach_status
- deal_status
- deliverable_status
- posting_status
- payout_status
- agreed_rate
- due_date
- delivered_at
- posted_at

## 14. Metrics That Matter
### Product metrics
- number of creators saved
- weekly active organizations
- campaigns created
- creators added to campaigns
- notes/status updates per active organization
- dashboard usage frequency

### Business / customer value metrics
- time saved per operator
- creators managed per team member
- campaign completion rate
- payout tracking accuracy
- visibility into creator performance
- ROI reporting confidence

## 15. Design Principles
This design direction is based on the inspiration references in `inspo/`, especially the Cosmos landing page, auth flow, onboarding surfaces, and dark product UI patterns.

### 15.1 Overall Creative Direction
- editorial luxury + creative-tech minimalism
- premium, quiet, and art-directed rather than feature-dense or salesy
- calm, culturally aware, and high-taste rather than loud or startup-gimmicky
- soft but confident
- restrained and intentional
- more "fashion brand meets software" than "generic B2B SaaS"

The product should feel like two related layers:
- marketing layer: emotional, spacious, identity-led
- product layer: precise, structured, operator-first, but still premium and quiet

The goal is not to literally copy a consumer inspiration app. The goal is to borrow its taste level, pacing, restraint, and atmosphere, then apply that to a campaign-first internal tool.

### 15.2 Design Goals For Billion Views
- operator-first and fast
- data-dense but clean
- easy to scan across many creators
- campaign-first navigation
- strong filtering everywhere
- campaign workflow should feel like pipeline software
- analytics should answer action-oriented questions, not just show charts
- brand and product should feel cohesive from landing page through app onboarding

### 15.3 Landing Page Direction
The landing page should feel highly minimal, editorial, and premium. It should sell the feeling of clarity, taste, and control before it explains the product in detail.

Structure:
- minimal top navigation
- centered hero
- one short support sentence
- one primary CTA
- manifesto-style editorial scroll sections
- one strong visual interruption, with two max
- quiet final CTA
- stripped footer

Navigation style:
- logo on the left
- very small number of links
- login link
- one stronger pill CTA on the right
- no heavy borders, dense menus, or oversized chrome

Hero style:
- two-line headline that feels like a thesis, not a feature list
- one-line subhead
- one CTA
- oversized whitespace around everything
- no product screenshot wall above the fold
- no logos, review stars, testimonial clutter, or feature dump near the hero

Storytelling style:
- the page should unfold as isolated editorial statements
- each phrase should get its own breathing room
- pacing matters more than information density
- copy should feel manifesto-like rather than explanatory
- repetition is allowed when it improves rhythm

Landing page copy architecture:
1. define a space
2. define a feeling
3. define what existing tools get wrong
4. reframe Billion Views as clarity and control
5. end with a quiet invitation

For Billion Views specifically, the landing page should not open with a dry feature promise. It should open with a calm, identity-led statement about running creator campaigns with taste, clarity, and control.

### 15.4 Product App Direction
The app itself should take inspiration from the dark Cosmos product surfaces, but adapt them for a campaign operations product.

The product UI should feel:
- dark, cinematic, and premium
- minimal in chrome
- spacious even when information-rich
- focused on one primary task per screen
- clean enough for operators to move quickly

The app should not feel like:
- a bright corporate dashboard template
- a generic admin panel
- a noisy analytics tool full of hard borders and tiny widgets
- a fake "creative" product that hides data behind style

Practical app direction:
- use organization -> campaign as the main context at all times
- make campaign detail pages the primary working surface
- treat creators and videos as tabs, sections, or linked views inside campaign context
- use a lightweight top bar with minimal nav, strong search, and focused actions
- avoid giant permanent sidebars unless clearly necessary
- use large rounded panels, quiet dividers, and low-contrast surfaces
- let the interface breathe instead of stacking small cards everywhere

### 15.5 Auth And Onboarding Experience
The auth and onboarding references in `inspo/` show a strong direction for the first-use experience.

Google auth should follow this pattern:
- full-screen dark cinematic background
- subtle abstract blurred or smoky visual texture
- centered elevated card
- minimal copy
- one primary action: `Continue with Google`
- optional small secondary helper text only if needed

Onboarding should feel:
- single-task and guided
- elegant, not instructional-heavy
- centered and focused
- built from large rounded cards and quiet surfaces
- more like a sequence of intentional setup moments than a long form

Recommended onboarding pattern:
1. continue with Google
2. create or join organization
3. create first campaign
4. connect data source
5. import first creators
6. land in campaign workspace with a small setup checklist

### 15.6 Visual System
Typography:
- large refined sans-serif headlines
- medium weight rather than extra bold
- carefully controlled line breaks
- short support copy
- small-to-medium UI copy with soft contrast
- optional restrained editorial serif moments only in brand, auth, or onboarding contexts
- avoid overly geometric or aggressive typography

Color system:
- primary background: near-black / rich charcoal
- primary surface: slightly lifted charcoal or smoke-black
- primary text: warm white, not pure white
- secondary text: muted gray
- CTA background: bright light neutral or white for contrast
- primary brand accent: `Gotall` green
- accent gradient: linear gradient from `#90FF4D` to `#13CA2D`
- when a solid accent is needed, use one of the two gradient stops rather than inventing a new green
- accent usage should be selective: key CTAs, active states, highlights, success moments, and important data emphasis
- do not introduce additional brand accent colors beyond neutrals and the `Gotall` green system
- avoid loud multicolor gradients, neon palettes, and overly saturated non-brand hues

Shape and component language:
- oversized border radius
- pill-shaped buttons, search bars, and inputs
- soft shadows or faint strokes only when needed
- cards should feel like objects placed on a dark stage
- use glass or translucency sparingly and only when it adds atmosphere without hurting legibility

Spacing:
- oversized vertical rhythm
- generous internal padding
- lots of negative space around hero, auth, and onboarding moments
- preserve spaciousness on mobile instead of collapsing into dense stacks
- design should feel like museum-wall spacing, not dashboard compression

Composition:
- centered compositions for brand moments
- narrow text width for manifesto sections
- one major visual moment at a time
- avoid overcrowded multi-column marketing blocks
- product screens can be denser, but should still feel controlled and calm

### 15.7 Imagery And Product Visuals
Image direction should be:
- editorial
- cinematic
- curated
- muted
- intentional

Do use:
- art-directed product mockups
- selective dashboard crops
- blurred or atmospheric background visuals
- imagery that feels premium and composed

Do not use:
- generic SaaS illustrations
- bright corporate stock photos
- icon explosions
- over-labeled screenshot callouts everywhere

If product visuals appear on the landing page, they should feel framed like objects or artifacts, not like dense annotated demos.

### 15.8 Motion And Interaction
- slow fade-ins on scroll
- gentle upward reveals
- subtle opacity transitions
- clean hover states
- CTA hover states can slightly brighten, invert, or sharpen
- no bounce
- no exaggerated parallax
- no gimmicky motion

The overall interaction feeling should be smooth, polished, and quiet.

### 15.9 Product-Specific UI Guidance
Because this is an internal campaign ops tool, usability still has to win.

Campaign pages should emphasize:
- top-level campaign health and status
- quick creator scanning
- fast status changes
- recent video performance
- payout visibility
- notes and internal workflow context

Data views should feel premium without becoming vague:
- tables should be roomy, legible, and softly separated
- charts should use thin strokes and restrained color
- filters should be prominent but not visually heavy
- modals and drawers should be large, focused, and low-noise
- empty states should feel polished, not cartoonish

### 15.10 Design Guardrails
- do not build a generic startup landing page
- do not build a bright enterprise dashboard
- do not let the product become so artistic that operators lose speed
- do not overuse gradients, badges, borders, or decorative widgets
- do not overwhelm the landing page with feature sections
- do not turn the product into a content feed when the real job is campaign operations
- every screen should feel intentional, restrained, and high-conviction

## 16. Technical Notes
At a product level, the system will likely need:
- Google OAuth authentication
- organization and membership support
- normalized creator and platform-account models
- external data provider API integration layer
- periodic sync and caching for provider data
- snapshot tables for metrics history
- chart-friendly aggregation layer
- audit/activity log for team collaboration

Open implementation questions:
- which provider endpoints are available and most reliable
- sync frequency, caching, and rate limit strategy for the data provider API
- which Viral fields should be stored raw vs normalized locally
- what ROI means in MVP if attribution is manual vs integrated
- whether campaign notes/statuses/payouts should remain local-only or sync back anywhere

## 17. Risks
- dependency on external provider availability and schema stability
- sync delays or stale cached data could affect trust in dashboards
- mapping provider entities into our preferred internal model may get messy
- "ROI" can be ambiguous without downstream conversion data
- teams may want custom workflow stages beyond defaults

## 18. Suggested MVP Build Order
1. Google auth + organization scaffolding
2. External data provider integration + sync/caching layer
3. campaign model and campaign detail experience
4. creator database and creator-to-campaign linking
5. video tracking inside campaigns
6. campaign statuses and notes
7. payouts
8. dashboard analytics
9. filters, polish, and exports

## 19. Open Questions
- Who is the exact first ICP: app marketers, ecommerce brands, or agencies?
- Is creator discovery part of MVP, or are we only consuming creators already available through the connected provider?
- Do we want one organization per company with multiple team members from day one?
- Do we need CSV import/export in v1?
- How should ROI be entered in MVP: manual input, campaign-level estimate, or not included initially?
- Which provider objects/endpoints do we want to support in v1?
- Should the app support manual creator creation at all, or only provider-backed records?

## 20. Current Product Direction
For v1, the product should optimize for:
- a small team running active creator campaigns
- a provider-backed data workflow
- an organization -> campaign -> creators/videos structure
- a premium editorial brand layer with a calm dark product UI
- strong tracking and operations over building new data collection
- clear dashboards for decision-making
- a modern internal tool UX

## 21. Next Docs To Create
After this PRD, we should create:
- `MVP_SCOPE.md`
- `USER_FLOWS.md`
- `DB_SCHEMA.md`
- `APP_STRUCTURE.md`
- `ROADMAP.md`
