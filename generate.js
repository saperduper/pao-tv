import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const API_URL = 'https://www.gazzetta.gr/gztfeeds/tvschedule-v2';
const DEFAULT_TIME_ZONE = 'Europe/Athens';
const BASE_ORIGIN = 'https://www.gazzetta.gr';

const ALLOWED_RAW = 'ΠΑΝΑΘΗΝΑΙΚΟΣ';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const normalize = (s) => {
  if (!s || !s.normalize) return s || '';
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
};

const normalizeText = (text) => normalize(text).toUpperCase();
const allowedNormalized = normalizeText(ALLOWED_RAW);

const eventMatchesAllowed = (event) => {
  if (!event) return false;
  const candidates = [
    event.event_text,
    event.participant1?.name,
    event.participant2?.name,
  ];
  return candidates.some(
    (text) => text && normalizeText(text).includes(allowedNormalized)
  );
};

const eventKey = (event) => {
  const p1 = event.participant1?.name || '';
  const p2 = event.participant2?.name || '';
  const ch1 = event.channel1?.name || '';
  return `${event.plainTime || ''}|${event.event_text || ''}|${p1}|${p2}|${ch1}`;
};

const getCalendarParts = (instant, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
};

const addCalendarDays = ({ year, month, day }, amount) => {
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    dayOfWeek: date.getUTCDay(),
  };
};

const makeDateKey = ({ day, month }) =>
  `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;

const formatDateLabel = ({ day, month, dayOfWeek }) =>
  `${DAY_NAMES[dayOfWeek]} ${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}`;

const safeImageUrl = (src) => {
  if (!src) return '';
  try {
    const url = new URL(String(src), BASE_ORIGIN);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};

const img = (src, alt, cls) => {
  const url = safeImageUrl(src);
  return url
    ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" class="${cls}">`
    : '';
};

const renderEvent = (event) => {
  const p1Name = event.participant1?.name || '';
  const p2Name = event.participant2?.name || '';
  const p1Logo = event.participant1?.logo || '';
  const p2Logo = event.participant2?.logo || '';
  const title =
    [p1Name, p2Name].filter(Boolean).join(' - ') ||
    event.event_text ||
    '';
  const channel = event.channel1?.name || '';
  const channelLogo = event.channel1?.logo || '';
  const sport = event.sport_name || '';
  const time = event.plainTime || '';
  const league = event.league?.name || '';

  return `
    <div class="event">
      <div class="event-time">${escapeHtml(time)}</div>
      <div class="event-body">
        <div class="event-title">
          ${p1Logo ? `<span class="team-logo-wrap">${img(p1Logo, p1Name, 'team-logo')}</span>` : ''}
          <span class="team-names">${escapeHtml(title)}</span>
          ${p2Logo ? `<span class="team-logo-wrap">${img(p2Logo, p2Name, 'team-logo')}</span>` : ''}
        </div>
        <div class="event-meta">
          ${sport ? `<span class="event-sport">${escapeHtml(sport)}</span>` : ''}
          ${league ? `<span class="event-league">${escapeHtml(league)}</span>` : ''}
          ${channel ? `<span class="event-channel">
            ${channelLogo ? img(channelLogo, channel, 'channel-logo') : ''}
            ${escapeHtml(channel)}
          </span>` : ''}
        </div>
      </div>
    </div>`;
};

const escapeHtml = (value) => {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const renderPage = (dates) => {
  const now = new Date();
  const timeZone = DEFAULT_TIME_ZONE;
  const todayParts = getCalendarParts(now, timeZone);
  const days = Array.from({ length: 7 }, (_, index) => {
    const calendarDate = addCalendarDays(todayParts, index);
    return {
      dateKey: makeDateKey(calendarDate),
      label: formatDateLabel(calendarDate),
      today: index === 0,
    };
  });
  const generatedAt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: 'h23',
  }).format(now);

  const dateGroups = days.map(({ dateKey, label, today }) => {
    const seen = new Set();
    const events = (dates[dateKey]?.events || []).filter((event) => {
      if (!eventMatchesAllowed(event)) return false;
      const key = eventKey(event);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { label, today, events };
  });
  const datesHtml = dateGroups
    .map(({ label, today, events }) => {
      const eventsHtml = events.length
        ? events.map(renderEvent).join('\n')
        : '<div class="empty-day">No events</div>';
      return `
        <section class="date-group">
          <h2 class="date-header">
            ${escapeHtml(label)}
            ${today ? '<span class="today-badge">TODAY</span>' : ''}
          </h2>
          <div class="events-list">${eventsHtml}</div>
        </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Panathinaikos TV Schedule</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    :root {
      --green: #16b83c;
      --text: #171717;
      --muted: #777;
      --border: #dedede;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
    }
    body { margin: 0; color: var(--text); background: #fff; font: 14px/1.6 var(--mono); }
    .container { max-width: 980px; margin: 0 auto; padding: 34px 24px 20px; }
    .page-header { margin-bottom: 24px; }
    .page-header h1 { display: flex; align-items: center; gap: 10px; margin: 0; font-size: clamp(26px, 4vw, 34px); line-height: 1.2; letter-spacing: -.04em; }
    .page-logo { width: 2.1em; height: 2.1em; flex: 0 0 auto; border-radius: 50%; object-fit: contain; }
    .source { margin: 8px 0 0; color: var(--muted); font-size: 12px; }
    .source a { color: inherit; text-decoration-thickness: 1px; text-underline-offset: 2px; }
    .date-group {
      margin: 0 0 22px;
      padding: 14px 16px;
      border: 2px solid var(--text);
      border-radius: 5px;
      background: #fff;
      box-shadow: 3px 3px 0 var(--text);
    }
    .date-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 8px;
      font-size: 18px;
      letter-spacing: -.02em;
    }
    .today-badge { padding: 2px 6px; border-radius: 2px; background: #e8f8eb; color: #087d25; font-size: 10px; letter-spacing: .04em; }
    .events-list { display: flex; flex-direction: column; }
    .event {
      display: flex;
      align-items: stretch;
      border: 0;
      border-left: 3px solid var(--green);
      background: #fff;
      transition: background .15s ease;
    }
    .event:hover { background: #f8fff9; }
    .event-time { flex: 0 0 82px; display: flex; align-items: flex-start; justify-content: center; padding: 13px 10px; font-size: 14px; font-weight: 700; }
    .event-body { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 11px 14px; }
    .event-title { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; margin: 0 0 5px; font-size: 14px; font-weight: 600; }
    .team-logo-wrap { display: inline-flex; align-items: center; }
    .team-logo { display: block; width: 26px; height: 26px; border-radius: 50%; object-fit: contain; }
    .team-names { white-space: nowrap; }
    .event-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; }
    .event-sport, .event-league { color: var(--muted); }
    .event-channel { display: inline-flex; align-items: center; gap: 6px; padding: 2px 6px; border: 1px solid var(--text); border-radius: 2px; background: #fff; color: var(--text); font-size: 11px; }
    .channel-logo { width: 16px; height: 16px; border-radius: 2px; object-fit: contain; }
    .empty-day { padding: 12px 10px; color: var(--muted); font-size: 12px; }
    .footer { padding: 18px 0; border-top: 1px solid var(--border); color: var(--muted); font-size: 11px; }
    @media (max-width: 560px) {
      .container { padding: 24px 16px 16px; }
      .page-header h1 { font-size: 25px; }
      .date-header { font-size: 16px; }
      .event { flex-direction: column; }
      .event-time { flex-basis: auto; width: 100%; flex-direction: row; justify-content: flex-start; padding: 8px 10px 2px; font-size: 12px; }
      .event-body { padding: 4px 10px 10px; }
      .event-title { font-size: 12px; }
      .event-meta, .empty-day { font-size: 10px; }
      .event-channel { font-size: 10px; }
    }
  </style>
</head>
<body>
  <main class="container">
    <header class="page-header">
      <h1><img class="page-logo" src="https://i.pinimg.com/736x/8f/95/37/8f9537984b173767adcaed9a0b2a9ec7.jpg" alt="Panathinaikos logo">Panathinaikos TV schedule</h1>
      <p class="source">Data sourced from <a href="https://www.gazzetta.gr/tv-program" target="_blank" rel="noopener noreferrer">gazzetta.gr</a></p>
    </header>
    ${datesHtml}
    <footer class="footer">
      <div>Last updated: ${escapeHtml(generatedAt)} (${escapeHtml(timeZone)})</div>
    </footer>
  </main>
</body>
</html>`;
};

const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const validateApiData = (data) => {
  if (!isRecord(data) || !isRecord(data.dates)) {
    throw new Error('Gazzetta API response must contain a dates object');
  }

  const dateEntries = Object.entries(data.dates);
  if (dateEntries.length === 0) {
    throw new Error('Gazzetta API response dates object must not be empty');
  }

  for (const [date, dateData] of dateEntries) {
    if (!/^\d{2}\/\d{2}$/.test(date)) {
      throw new Error(`Gazzetta API response: invalid date key ${JSON.stringify(date)}`);
    }
    if (!isRecord(dateData) || !Array.isArray(dateData.events)) {
      throw new Error(`Gazzetta API response: dates[${JSON.stringify(date)}].events must be an array`);
    }

    dateData.events.forEach((event, index) => {
      const path = `dates[${JSON.stringify(date)}].events[${index}]`;
      if (!isRecord(event)) {
        throw new Error(`Gazzetta API response: ${path} must be an object`);
      }
    });
  }

  return dateEntries.length;
};

async function generateSite() {
  const outputPath = resolve(process.env.OUTPUT_DIRECTORY || 'dist', 'index.html');

  const response = await fetch(API_URL, {
    headers: {
      accept: 'application/json',
      'user-agent': 'gazzetta-tv-filter-static-generator/1.0',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Gazzetta API returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const dateCount = validateApiData(data);

  const html = renderPage(data.dates);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, 'utf8');

  return { outputPath, bytes: Buffer.byteLength(html), dateCount };
}

const { outputPath, bytes, dateCount } = await generateSite();
console.log(`Generated ${outputPath} (${bytes} bytes, ${dateCount} API dates)`);
