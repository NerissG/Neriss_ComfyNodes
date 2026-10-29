export type LoraChoice = { name: string; label: string; folder: string; search: string };

function searchText(value: string): string {
  return value.toLocaleLowerCase().replace(/[\\/_.-]+/g, " ");
}

export function prepareLoraChoices(names: string[]): LoraChoice[] {
  return names.map((name) => {
    const path = name.replace(/\\/g, "/");
    const separator = path.lastIndexOf("/");
    return {
      name,
      label: path.slice(separator + 1).replace(/\.safetensors$/i, ""),
      folder: separator < 0 ? "" : path.slice(0, separator),
      search: searchText(path),
    };
  });
}

export function filterLoraChoices(choices: LoraChoice[], query: string): LoraChoice[] {
  const terms = searchText(query).trim().split(/\s+/).filter(Boolean);
  return terms.length ? choices.filter((choice) => terms.every((term) => choice.search.includes(term))) : choices;
}
