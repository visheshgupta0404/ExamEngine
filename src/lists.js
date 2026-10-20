export function paginate(items, page = 1, size = 20) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  page = Math.min(pages, Math.max(1, Number.isInteger(page) ? page : 1));
  return {
    items: items.slice((page - 1) * size, page * size),
    page,
    pages,
    total: items.length,
    start: items.length ? (page - 1) * size + 1 : 0,
    end: Math.min(page * size, items.length),
  };
}
export function searchItems(items, query, text) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return words.length
    ? items.filter((item) => {
        const value = text(item).toLocaleLowerCase();
        return words.every((word) => value.includes(word));
      })
    : items;
}
