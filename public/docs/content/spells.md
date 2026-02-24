# Spells

A Spell is a saved chain of tools. Where a tool handles a single step — generate an image, caption it, transform it — a Spell connects multiple tools into a repeatable pipeline you can run, share, and publish.

---

## How Spells Work

Each tool on the canvas produces outputs that can be wired directly into the inputs of another tool. When that arrangement of tools and connections is useful enough to reuse, you save it as a Spell.

Running a Spell executes the tools in sequence, passing outputs downstream automatically. Parameters that vary between runs can be exposed — everything else is preset.

---

## Building a Spell

1. **Open the canvas** and add the tools you want to chain.
2. **Connect outputs to inputs** — drag from an output port on one tool window to an input port on another.
3. **Configure fixed parameters** — set any values that should stay constant across runs.
4. **Expose variable parameters** — mark inputs you want users to control at run time. These become the Spell's interface.
5. **Save the Spell** — give it a name. It is now reusable from the Spells panel.

---

## Running a Spell

Open a saved Spell from the Spells panel. You will see only the exposed inputs — fill them in and run. The full chain executes in the background and results appear as each tool completes.

Spells respect the same credit cost as running each tool individually.

---

## Sharing Spells

Spells can be published publicly, making them discoverable and runnable by other users. When someone runs your published Spell, you earn a share of the execution cost.

- Published Spells appear in the community library
- Earnings are credited to your account automatically
- You can unpublish a Spell at any time

---

## Spell Versioning

Tools evolve over time. When a tool updates its parameters, NOEMA attempts to migrate saved Spells forward automatically. If a Spell references a parameter that no longer exists, the canvas will flag it so you can update the mapping manually.

---

## Tips

- **Start simple.** A two-tool Spell (prompt → image) is already useful. Add complexity incrementally.
- **Expose only what varies.** The fewer inputs a Spell exposes, the easier it is to run correctly.
- **Use String Primitive for glue.** The String Primitive tool is useful for concatenating or transforming text between steps without involving a language model.
