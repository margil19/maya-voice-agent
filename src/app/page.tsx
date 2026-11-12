// One-stop page for reviewers: how to call Maya, who to pretend to be,
// what to listen for, and how she was built and improved.

import { patients } from "@/lib/clinic/data";
import { FEATURED, SCENARIOS, TRY_TO_BREAK, type Scenario } from "./scenarios";

const PHONE_DISPLAY = "(401) 399-6716";
const GITHUB_URL = "https://github.com/margil19/maya-voice-agent";

const fmtDob = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtPhone = (d: string) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
const fmtUsd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function patientFacts(id: string) {
  const p = patients.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown patient ${id}`);
  const balance = p.statement.lines.reduce((s, l) => s + l.patientResponsibility, 0) - p.payments.reduce((s, x) => s + x.amount, 0);
  return { name: `${p.firstName} ${p.lastName}`, dob: fmtDob(p.dob), account: p.accountNumber, phone: fmtPhone(p.phone), balance };
}

const TONE_STYLES: Record<Scenario["tone"], string> = {
  core: "bg-accent-soft text-accent",
  edge: "bg-warn-soft text-warn-ink",
  safety: "bg-danger-soft text-danger-ink",
};

function Identity({ id, override }: { id: string; override?: string }) {
  const f = patientFacts(id);
  if (override) {
    return <p className="text-sm text-muted">{override} <span className="whitespace-nowrap">(Kevin&apos;s phone: {f.phone})</span></p>;
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="text-muted">Name</dt>
      <dd className="font-medium">{f.name}</dd>
      <dt className="text-muted">Born</dt>
      <dd>{f.dob}</dd>
      <dt className="text-muted">Account</dt>
      <dd className="font-mono">{f.account}</dd>
      <dt className="text-muted">Phone</dt>
      <dd className="font-mono">{f.phone}</dd>
      <dt className="text-muted">Balance</dt>
      <dd>{fmtUsd(f.balance)}</dd>
    </dl>
  );
}

function ScenarioCard({ s }: { s: Scenario }) {
  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-col gap-2">
        <span className={`w-fit rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_STYLES[s.tone]}`}>{s.tag}</span>
        <h3 className="text-lg font-semibold leading-snug">{s.title}</h3>
        <p className="text-sm text-muted">{s.situation}</p>
      </div>
      <Identity id={s.patientId} override={s.callerOverride} />
      <div className="text-sm">
        <p className="mb-1 font-medium">Try saying</p>
        <ul className="space-y-1 text-muted">
          {s.sayThis.map((line) => (
            <li key={line}>&ldquo;{line}&rdquo;</li>
          ))}
        </ul>
      </div>
      <p className="mt-auto rounded-xl bg-surface-2 p-3 text-sm">
        <span className="font-medium">Listen for: </span>
        {s.watchFor}
      </p>
    </article>
  );
}

const ITERATIONS = [
  {
    version: "v1.1",
    found: "First test call: she spoke her internal reasoning out loud.",
    fix: "Prompt rule: everything she outputs is spoken.",
  },
  {
    version: "v1.2",
    found: "Real call: speech-to-text heard \"Reese\" for \"Reyes\", so verification failed. She also miscounted a 10-digit phone number as 9, and the tone came across as harsh.",
    fix: "Last name can match by sound when DOB and account match exactly; digits checked in code, not by the model; warmer prompt and a new voice.",
  },
  {
    version: "v1.4",
    found: "She still narrated around tool calls (\"the tool says it sounds alike\"). Replays on four models showed reasoning models leak; non-reasoning ones don't.",
    fix: "Switched to GPT-4.1: zero narration, ~1.2 s replies (from ~1.8 s). Internal match details hidden from the agent.",
  },
  {
    version: "v1.5",
    found: "Real call: \"H O\" was heard as \"eight zero\"; she quoted \"about one ninety-two\" from her own math; she offered a hardship-only plan unprompted.",
    fix: "Account matched on its six digits; exact plan amounts computed by the backend; hardship plans only when the caller raises money trouble.",
  },
  {
    version: "v1.6",
    found: "Real call: \"Ayesha\" transcribed for \"Aisha\" failed verification three times, and a fourth attempt still got through: the 3-try lock lived in one server's memory.",
    fix: "First names match by sound too (DOB and account/phone still exact). The lock moved to shared Redis, with a safe fallback. Voice and pacing tuned by ear.",
  },
];

const GUARDRAILS = [
  ["Identity before anything", "Account tools need a signed, call-bound token that only a successful verification issues. Three wrong tries lock the call."],
  ["No card numbers on the phone", "Payment always goes through a secure link sent to the contact on file, shown masked."],
  ["Policy in code", "Payment plans are validated by the backend: 6 months automatically; up to 12 only for stated hardship, pending human approval."],
  ["No promises", "Disputes and out-of-network questions become tickets with full notes, and the balance is paused while a person reviews it."],
  ["Every number from the system", "Explanations and plan amounts come from tool results; the model never does the math."],
  ["A human on request", "Warm transfer during business hours, a callback after hours, with no pushback."],
];

const PRODUCTION_PHASES = [
  { title: "Discover", when: "Week 1", what: "Pull 200 real calls; baseline cost, handle time and collections.", gate: "Scope and targets signed off" },
  { title: "Integrate", when: "Weeks 1–2", what: "Connect EHR, payments and phones; client policy in code.", gate: "Real data in sandbox; security passed" },
  { title: "Test", when: "Weeks 2–3", what: "Replay real calls, red-team privacy, staff test calls.", gate: "Zero safety misses; every dollar right" },
  { title: "Roll out", when: "Weeks 3–6", what: "After-hours, then overflow, then daytime. Pinned versions.", gate: "One clean week per stage" },
  { title: "Monitor", when: "Daily", what: "Resolution, dollars, transfers; alert on any safety event.", gate: "Safety events stay at zero" },
  { title: "Improve", when: "Monthly", what: "Fix top failure types; steering-committee ROI review.", gate: "ROI the CFO will sign" },
];

export default function Home() {
  const featured = FEATURED;
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-4 py-10 sm:px-6 sm:py-16">
      {/* Hero */}
      <section className="flex flex-col gap-6">
        <p className="text-sm font-medium text-accent">Work sample · AI Product Manager application</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Meet Maya</h1>
        <p className="max-w-2xl text-lg text-muted">
          An AI voice agent that answers patient billing calls for <span className="text-ink">Harbor Orthopedics</span>, a
          fictional four-location orthopedic group in New York. She explains bills, takes payments, sets up plans, fixes
          insurance problems, and knows when to hand off to a person.
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="inline-flex w-fit items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-3.5">
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 text-accent" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
            </svg>
            <span className="text-muted">Call Maya</span>
            <span className="select-all text-lg font-semibold tracking-wide">{PHONE_DISPLAY}</span>
          </div>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-2 rounded-full bg-accent px-5 py-3 font-semibold text-accent-ink transition hover:opacity-90"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
            </svg>
            View the code on GitHub
          </a>
        </div>
        <p className="text-sm text-muted">Open 24/7 · 2–4 minutes per scenario · all patient data is made up</p>
      </section>

      {/* How to */}
      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ["1", "Pick a caller", "Choose a patient below. Each one tests a different situation."],
          ["2", "Call and say why", "Talk naturally. Interrupt, change your mind, go off-script."],
          ["3", "Verify, then explore", "Maya asks for your name, date of birth, and the account number or phone on file."],
        ].map(([n, title, body]) => (
          <div key={n} className="rounded-2xl border border-line bg-surface p-5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{n}</span>
            <h2 className="mt-3 font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted">{body}</p>
          </div>
        ))}
      </section>

      {/* Featured */}
      <section className="flex flex-col gap-5">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">If you only make one call</h2>
          <p className="mt-1 text-muted">The most common billing call there is, end to end.</p>
        </div>
        <article className="grid gap-6 rounded-2xl border border-line bg-surface p-6 md:grid-cols-[1fr_1.3fr]">
          <div className="flex flex-col gap-3">
            <span className={`w-fit rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_STYLES.core}`}>{featured.tag}</span>
            <h3 className="text-xl font-semibold leading-snug">{featured.title}</h3>
            <p className="text-sm text-muted">{featured.situation}</p>
            <Identity id={featured.patientId} />
          </div>
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-2 text-sm font-medium">Try saying, in order</p>
              <ol className="space-y-2">
                {featured.sayThis.map((line, i) => (
                  <li key={line} className="flex gap-3 text-sm">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs text-muted">{i + 1}</span>
                    <span>&ldquo;{line}&rdquo;</span>
                  </li>
                ))}
              </ol>
            </div>
            <p className="rounded-xl bg-surface-2 p-3 text-sm">
              <span className="font-medium">Listen for: </span>
              {featured.watchFor}
            </p>
          </div>
        </article>
      </section>

      {/* All scenarios */}
      <section className="flex flex-col gap-5">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">More callers to try</h2>
          <p className="mt-1 text-muted">
            <span className="text-accent">Green</span> is everyday calls, <span className="text-warn-ink">amber</span> is
            judgment calls, <span className="text-danger-ink">red</span> is safety and privacy.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {SCENARIOS.map((s) => (
            <ScenarioCard key={`${s.patientId}-${s.tag}`} s={s} />
          ))}
        </div>
      </section>

      {/* Try to break her */}
      <section className="flex flex-col gap-5">
        <h2 className="text-2xl font-semibold tracking-tight">Try to break her</h2>
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          {TRY_TO_BREAK.map((t, i) => (
            <div key={t.say} className={`grid gap-1 p-4 sm:grid-cols-2 sm:gap-6 ${i > 0 ? "border-t border-line" : ""}`}>
              <p className="font-medium">{t.say}</p>
              <p className="text-sm text-muted">{t.expect}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Guardrails */}
      <section className="flex flex-col gap-5">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Guardrails enforced in code, not just the prompt</h2>
          <p className="mt-1 max-w-2xl text-muted">
            Prompts drift; code doesn&apos;t. Even if Maya were talked into skipping a rule, the backend would still refuse.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GUARDRAILS.map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-line bg-surface p-5">
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="flex flex-col gap-5">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
          {[
            ["Caller", "Any phone"],
            ["Voice AI platform", "Speech recognition, GPT-4.1, natural voice, call-center ambience"],
            ["Clinic backend", "Patients, claims, policy rules, audit log · Next.js on Vercel"],
          ].map(([title, body], i, arr) => (
            <div key={title} className="flex flex-col items-center gap-3 md:flex-1 md:flex-row">
              <div className="w-full rounded-2xl border border-line bg-surface p-4 text-center">
                <p className="font-semibold">{title}</p>
                <p className="mt-1 text-sm text-muted">{body}</p>
              </div>
              {i < arr.length - 1 && (
                <span aria-hidden className="text-sm text-muted md:whitespace-nowrap">
                  {i === 0 ? "voice ⇄" : "signed tool calls ⇄"}
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="text-sm text-muted">
          Maya&apos;s prompt, voice, model and tools are configuration as code, versioned in git. Callers only ever reach a
          published version; changes are tested on a separate copy first.
        </p>
      </section>

      {/* Iteration log */}
      <section className="flex flex-col gap-5">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">How Maya got better: real calls → fixes</h2>
          <p className="mt-1 max-w-2xl text-muted">
            Each version came from a real phone call or replay, traced to a root cause in the transcript, and fixed in
            the layer where it belonged: code, prompt, or model choice.
          </p>
        </div>
        <ol className="flex flex-col gap-3">
          {ITERATIONS.map((it) => (
            <li key={it.version} className="grid gap-3 rounded-2xl border border-line bg-surface p-5 md:grid-cols-[4rem_1fr_1fr]">
              <span className="w-fit rounded-full bg-surface-2 px-2.5 py-0.5 font-mono text-sm">{it.version}</span>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Found</p>
                <p className="mt-1 text-sm">{it.found}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Fixed</p>
                <p className="mt-1 text-sm">{it.fix}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Production plan */}
      <section className="flex flex-col gap-5">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">How I&apos;d take Maya to production</h2>
          <p className="mt-1 text-muted">Live in about three weeks, then run like a P&amp;L. Every phase ends in a go / no-go gate.</p>
        </div>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PRODUCTION_PHASES.map((ph, i) => (
            <li key={ph.title} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">
                  <span className="text-accent">{i + 1}.</span> {ph.title}
                </h3>
                <span className="text-xs text-muted">{ph.when}</span>
              </div>
              <p className="text-sm">{ph.what}</p>
              <p className="mt-auto text-xs text-muted">
                <span className="font-medium text-accent">Gate:</span> {ph.gate}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="border-t border-line pt-6 text-sm text-muted">
        <p>
          Built on a voice AI platform with GPT-4.1, and Next.js on Vercel. Harbor Orthopedics and every patient, claim and phone number on
          this page are fictional. Code, design docs and the full iteration history are{" "}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
            on GitHub
          </a>
          .
        </p>
      </footer>
    </main>
  );
}
