/** Joins the class names that are set; falsy entries are skipped. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
