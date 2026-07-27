/**
 * GitLab names a project after its full path: "Group / Subgroup / Project".
 *
 * The leading group is whatever an organisation puts at the root — "Customers",
 * "Templates", a personal username — so nearly every project shares it. Letting
 * it match a filter turns a search for "templates" into a search for half the
 * list, which is why it's split off here rather than searched.
 */

/** The separator GitLab puts between namespace segments in a display name. */
const NAMESPACE_SEPARATOR = /\s*\/\s*/;

interface SplitProjectName {
  /** Leading group, without its separator. Empty when the name has no group. */
  namespace: string;
  /** Everything after the leading group — the part worth searching. */
  rest: string;
}

/**
 * Split a project's display name into its leading group and the rest.
 *
 * A name with no separator has no group to drop, so it stays searchable whole.
 *
 * @example
 * splitProjectName('Templates / Craft CMS template')
 * // → { namespace: 'Templates', rest: 'Craft CMS template' }
 * splitProjectName('Customers / OMA / oma-sanity')
 * // → { namespace: 'Customers', rest: 'OMA / oma-sanity' }
 * splitProjectName('dotfiles')
 * // → { namespace: '', rest: 'dotfiles' }
 */
export function splitProjectName(projectName: string | null | undefined): SplitProjectName {
  const name = projectName?.trim() ?? '';
  const match = NAMESPACE_SEPARATOR.exec(name);
  if (!match || match.index === 0) return { namespace: '', rest: name };
  return {
    namespace: name.slice(0, match.index),
    rest: name.slice(match.index + match[0].length),
  };
}

/** The part of a project's name a filter query is matched against. */
export function projectSearchText(projectName: string | null | undefined): string {
  return splitProjectName(projectName).rest;
}
