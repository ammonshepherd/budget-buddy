import { SingleFieldForm } from "./components";

export function CreateHouseholdPage({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  return (
    <section className="page-view stack" aria-labelledby="household-title">
      <header className="page-heading">
        <p className="eyebrow">One more step</p>
        <h1 id="household-title">Your household</h1>
        <p>Name the household this budget belongs to.</p>
      </header>
      <section className="list-card">
        <SingleFieldForm
          label="Household name"
          button="Create"
          inputMode="text"
          placeholder="The Smiths"
          onSubmit={onCreate}
        />
      </section>
    </section>
  );
}
