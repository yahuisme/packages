/* SPDX-License-Identifier: GPL-2.0-only
 * Native trigger_match from OpenWrt procd/service/trigger.c.
 * https://git.openwrt.org/project/procd.git
 * Keep prefix-at-first-.* semantics; this is not shell glob matching.
 */
#include <stdbool.h>
#include <string.h>
#include <stdio.h>
static bool trigger_match(const char *event, const char *match)
{
	char *wildcard = strstr(match, ".*");
	if (wildcard)
		return !strncmp(event, match, wildcard - match);
	return !strcmp(event, match);
}
int main(int argc, char **argv) {
 if (argc != 3) return 2;
 printf("%d\n", trigger_match(argv[1], argv[2]));
 return 0;
}
