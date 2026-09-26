#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "client/public/data/videos.json");
const errors = [];
const warnings = [];
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (error) {
  console.error(`FAIL: Unable to read ${file}: ${error.message}`);
  process.exit(1);
}
const videos = manifest.videos;
if (!Array.isArray(videos)) {
  console.error("FAIL: videos.json must contain a videos array.");
  process.exit(1);
}
const ids = new Map();
const sequences = new Map();
const required = ["sequence", "era", "age", "title", "creator", "youtube_id", "direct_url", "duration", "duration_seconds_source_listed", "role"];
const directPattern = /^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/;
// Warn on gaps above 50 million years: large enough to identify major coverage gaps without treating ordinary period boundaries as errors.
const CHRONOLOGY_GAP_WARNING_MA = 50;
const parseAgeRangeMa = (age) => {
  const matches = [...String(age ?? "").matchAll(/\b(\d+(?:\.\d+)?)\s*(Ga|Ma|ka)?\b/gi)];
  const defaultUnit = [...matches].reverse().find((match) => match[2])?.[2];
  const values = matches.flatMap((match) => {
    const unit = (match[2] ?? defaultUnit)?.toLowerCase();
    if (!unit) return [];
    const number = Number(match[1]);
    return [unit === "ga" ? number * 1000 : unit === "ka" ? number / 1000 : number];
  });
  if (/\bpresent\b/i.test(String(age ?? ""))) values.push(0);
  return values.length ? { young: Math.min(...values), old: Math.max(...values) } : null;
};
let totalSeconds = 0;
let previousSequence = -Infinity;
const datedRecords = [];
const datedCoreRecords = [];
const roleCounts = { "chronological core": 0, "deep dive": 0, supplement: 0 };
for (const [index, video] of videos.entries()) {
  const row = index + 1;
  for (const key of required) {
    const value = video?.[key];
    if (value === null || value === undefined || String(value).trim() === "") errors.push(`row ${row}: missing required field '${key}'`);
  }
  if (!Number.isSafeInteger(video?.sequence) || video.sequence < 1) errors.push(`row ${row}: sequence must be a positive integer`);
  else {
    if (sequences.has(video.sequence)) errors.push(`row ${row}: duplicate sequence ${video.sequence} (also row ${sequences.get(video.sequence)})`);
    sequences.set(video.sequence, row);
    if (video.sequence <= previousSequence) errors.push(`row ${row}: sequence numbers must increase in manifest order`);
    previousSequence = video.sequence;
  }
  if (typeof video?.youtube_id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(video.youtube_id)) errors.push(`row ${row}: missing/invalid 11-character YouTube ID`);
  else {
    if (ids.has(video.youtube_id)) errors.push(`row ${row}: duplicate YouTube ID ${video.youtube_id} (also row ${ids.get(video.youtube_id)})`);
    ids.set(video.youtube_id, row);
  }
  if (typeof video?.direct_url !== "string" || !directPattern.test(video.direct_url)) errors.push(`row ${row}: direct_url must be an individual https://www.youtube.com/watch?v=VIDEO_ID URL`);
  else if (video.youtube_id && directPattern.exec(video.direct_url)?.[1] !== video.youtube_id) errors.push(`row ${row}: youtube_id does not match direct_url`);
  if (Object.hasOwn(roleCounts, video?.role)) roleCounts[video.role] += 1;
  if (!Number.isSafeInteger(video?.duration_seconds_source_listed) || video.duration_seconds_source_listed <= 0) errors.push(`row ${row}: duration_seconds_source_listed must be a positive integer`);
  else totalSeconds += video.duration_seconds_source_listed;
  if (typeof video?.duration !== "string" || !/^\d{1,3}:\d{2}(?::\d{2})?$/.test(video.duration)) errors.push(`row ${row}: duration must be numeric time in M:SS or H:MM:SS format`);
  else {
    const parts = video.duration.split(":").map(Number);
    const durationValue = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    if (video.duration_seconds_source_listed && durationValue !== video.duration_seconds_source_listed) warnings.push(`row ${row}: display duration (${durationValue}s) differs from numeric source duration (${video.duration_seconds_source_listed}s)`);
  }
  const range = parseAgeRangeMa(video?.age);
  if (range) {
    const record = { row, sequence: video.sequence, range, age: video.age };
    datedRecords.push(record);
    if (video.role === "chronological core") datedCoreRecords.push(record);
  }
}
let overlapCount = 0;
for (let i = 1; i < datedRecords.length; i += 1) {
  const earlier = datedRecords[i - 1];
  const later = datedRecords[i];
  const overlaps = later.range.young <= earlier.range.old && later.range.old >= earlier.range.young;
  if (overlaps) {
    overlapCount += 1;
    continue;
  }
  if (later.range.young > earlier.range.old) errors.push(`row ${later.row}: chronology is clearly reversed (${later.age}) after ${earlier.age}`);
}
for (let i = 1; i < datedCoreRecords.length; i += 1) {
  const earlier = datedCoreRecords[i - 1];
  const later = datedCoreRecords[i];
  const gapMa = earlier.range.young - later.range.old;
  if (gapMa > CHRONOLOGY_GAP_WARNING_MA) {
    const gap = gapMa >= 1000 ? `${(gapMa / 1000).toFixed(gapMa % 1000 === 0 ? 0 : 2)} billion years` : `${Math.round(gapMa)} million years`;
    warnings.push(`chronological core seq ${earlier.sequence} → ${later.sequence}: explicit age labels leave a gap of about ${gap} (> ${CHRONOLOGY_GAP_WARNING_MA} million years)`);
  }
}
const h = Math.floor(totalSeconds / 3600);
const m = Math.floor((totalSeconds % 3600) / 60);
const s = totalSeconds % 60;
console.log(`Manifest: ${path.relative(root, file)}`);
console.log(`Primary video records: ${videos.length}`);
console.log(`Unique sequence numbers: ${sequences.size}`);
console.log(`Roles: ${roleCounts["chronological core"]} chronological core, ${roleCounts["deep dive"]} deep dive, ${roleCounts.supplement} supplement`);
console.log(`Calculated listed runtime: ${h} h ${m} m ${s} s (${(totalSeconds / 3600).toFixed(2)} h)`);
console.log(`Chronology: ${datedRecords.length} records with parseable ages; ${overlapCount} adjacent age ranges overlap and remain in supplied manifest order.`);
if (warnings.length) {
  console.warn(`\nWARNINGS (${warnings.length}):`);
  for (const warning of warnings) console.warn(`- ${warning}`);
}
if (errors.length) {
  console.error(`\nFAIL (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
if (warnings.length) console.log("PASS WITH WARNINGS: no structural validation errors.");
else console.log("PASS: URLs, IDs, required metadata, sequence uniqueness/order, chronology, and numeric durations are valid.");
