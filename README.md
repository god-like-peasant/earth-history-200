# Earth History 200

A lightweight, free, mobile-first chronological YouTube player for Earth's deep history. This is an evolving verified watchlist—not a completed 200-hour curriculum.

## Current dataset

- **42 primary records**, loaded from `client/public/data/videos.json` (copied from the supplied verified JSON manifest without changing its data).
- **110 h 57 min 40 sec** of listed individual-video runtime, calculated as the sum of `duration_seconds_source_listed`.
- The **chronological core** is arranged in time. Deep dives and supplements play in ascending manifest `sequence` order as adjacent/contextual films, so the full playlist is not represented as one strictly chronological sequence. The manifest's supplied direct YouTube URLs, titles, creator names, age strings, durations, and roles remain intact.
- “Verified” means that an individual direct YouTube watch link and its manifest structure were checked; it is not scientific endorsement, a guarantee of present-day availability, or an independent fact-check of each film's claims.

The CSV is a supplied audit/export companion. The JSON file is the one canonical source used by the app. No records have been invented or added.

## Playback and privacy

- One **Start Journey** action initiates the YouTube IFrame player. The player advances when YouTube reports the current video ended and browser policy permits scripted playback.
- A visible **Next Video / Continue to Next** control is the manual fallback. Embedded-video errors are shown with a safe skip to the next record.
- The sequence position and completed sequence numbers are stored in browser `localStorage` only; there is no backend, account, tracking database, or sign-in.
- YouTube content streams in YouTube's embedded player. This site does not download or host video files.

## Add verified records

Edit `client/public/data/videos.json` and append only individually verified direct YouTube watch records. Preserve the schema used in the existing records, including `duration_seconds_source_listed`, and assign increasing unique sequence numbers. The application sorts by sequence; the validator also checks source order and reports if ordering is inconsistent. Keep rejected/unverified research records out of this primary `videos` array.

## Validate

```sh
pnpm validate:manifest
```

The no-dependency validator checks required metadata, direct `youtube.com/watch?v=` URL shape, 11-character YouTube IDs, URL/ID matches, duplicate IDs, duplicate and increasing sequence numbers, numeric duration values, and chronological order wherever numeric age values can be parsed. It prints the runtime total and counts by role. It warns, but does not fail, when adjacent dated chronological-core records have an explicit age gap above **50 million years**; this threshold flags large coverage gaps while avoiding treating routine boundaries as validation errors. Broad or overlapping descriptive age labels are not rejected for overlap. It does not check present-day YouTube availability or scientifically adjudicate video claims.

## Run locally

```sh
pnpm install
pnpm dev
```

## Limitations

- The product name expresses the long-term goal. The present verified manifest totals approximately **110.96 hours**, not 200 hours.
- Geological labels are displayed as supplied. The long geological reference line is orientation only; the chronological core is arranged in time, while deep dives and supplements remain adjacent/contextual in the manifest order.
- YouTube embedding, playback, autoplay/advance, and availability depend on YouTube and the browser. Use the visible manual control if autoplay is blocked.
