// Joshua Nunez
// Optional paging for the list endpoints: ?limit=&offset=. Without a limit the list keeps the size it always had,
// so existing callers are unaffected. A limit is capped at 200 rows, and anything that is not a whole number is ignored.
const MAX_PAGE = 200;

function pageOf({ limit, offset } = {}, defaultLimit) {
  const l = Number(limit);
  const o = Number(offset);
  const wanted = limit !== undefined && limit !== null && limit !== '' && Number.isInteger(l) && l >= 1;
  return { limit: wanted ? Math.min(l, MAX_PAGE) : defaultLimit, offset: Number.isInteger(o) && o > 0 ? o : 0 };
}

module.exports = { MAX_PAGE, pageOf };
