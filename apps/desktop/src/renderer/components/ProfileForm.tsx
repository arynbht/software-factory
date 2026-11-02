import type { Profile } from "@arynbht/factory-catalog";
import { Check, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";

import type { ProfileMeta } from "../../shared/ipc";

function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-accent/40">
      <span className="text-sm">{props.label}</span>
      <input
        type="checkbox"
        className="h-4 w-4 accent-sky-500"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </label>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">
        {props.label}
      </span>
      {props.children}
    </label>
  );
}

const selectClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ProfileForm({
  repoPath,
  repoName,
}: {
  repoPath: string;
  repoName: string;
}) {
  const [meta, setMeta] = useState<ProfileMeta | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [stackText, setStackText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setError(null);
    setSaved(false);
    Promise.all([
      window.factory.profile.meta(),
      window.factory.profile.load(repoPath),
    ]).then(
      ([m, p]) => {
        if (!active) return;
        setMeta(m);
        const profile: Profile = p ?? {
          version: 1,
          name: repoName,
          type: (m.types[0] ?? "cli") as Profile["type"],
          stack: [],
          flags: {},
          "severity-floor": "low",
        };
        setDraft(profile);
        setStackText((profile.stack ?? []).join(", "));
      },
      (err: unknown) => {
        if (active) setError(errorMessage(err));
      },
    );
    return () => {
      active = false;
    };
  }, [repoPath, repoName]);

  if (error && !draft) {
    return (
      <p className="text-sm text-rose-400" role="alert">
        {error}
      </p>
    );
  }
  if (!meta || !draft) {
    return <p className="text-sm text-muted-foreground">Loading profile…</p>;
  }

  const patch = (changes: Partial<Profile>): void => {
    setDraft({ ...draft, ...changes });
    setSaved(false);
  };

  async function handleSave(): Promise<void> {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const stack = stackText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const next = await window.factory.profile.save(repoPath, {
        ...draft,
        stack,
      });
      setDraft(next);
      setStackText((next.stack ?? []).join(", "));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Profile</h2>
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saving ? "Saving…" : saved ? "Saved" : "Save"}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-rose-400" role="alert">
          {error}
        </p>
      )}

      <Card className="space-y-4 p-4">
        <Field label="Name">
          <input
            className={selectClass}
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Type">
            <select
              className={selectClass}
              value={draft.type}
              onChange={(e) =>
                patch({ type: e.target.value as Profile["type"] })
              }
            >
              {meta.types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Phase">
            <select
              className={selectClass}
              value={draft.phase ?? ""}
              onChange={(e) =>
                patch({
                  phase: (e.target.value || undefined) as Profile["phase"],
                })
              }
            >
              <option value="">(unset)</option>
              {meta.phases.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Severity floor">
            <select
              className={selectClass}
              value={draft["severity-floor"]}
              onChange={(e) =>
                patch({
                  "severity-floor": e.target.value as Profile["severity-floor"],
                })
              }
            >
              {meta.severities.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Stack (comma-separated)">
          <input
            className={selectClass}
            value={stackText}
            onChange={(e) => {
              setStackText(e.target.value);
              setSaved(false);
            }}
            placeholder="typescript, react, postgres"
          />
        </Field>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-3">
          <h3 className="mb-1 px-2 text-sm font-semibold">Risk flags</h3>
          {meta.flags.map((flag) => (
            <Toggle
              key={flag}
              label={flag}
              checked={draft.flags[flag as keyof Profile["flags"]] === true}
              onChange={(next) =>
                patch({
                  flags: { ...draft.flags, [flag]: next } as Profile["flags"],
                })
              }
            />
          ))}
        </Card>
        <Card className="p-3">
          <h3 className="mb-1 px-2 text-sm font-semibold">Lanes</h3>
          {meta.lanes.map((lane) => {
            const value =
              draft.lanes?.[lane.key as keyof NonNullable<Profile["lanes"]>];
            return (
              <Toggle
                key={lane.key}
                label={lane.title}
                checked={value !== false}
                onChange={(next) =>
                  patch({
                    lanes: {
                      ...draft.lanes,
                      [lane.key]: next,
                    } as Profile["lanes"],
                  })
                }
              />
            );
          })}
        </Card>
      </div>
    </div>
  );
}
