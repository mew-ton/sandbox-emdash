/**
 * Login button for the EmDash admin login page. The provider uses a plain
 * redirect flow, so the button is a link to the login route.
 */

export function LoginButton() {
	return (
		<a
			href="/_emdash/api/auth/discord/login"
			className="inline-flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium"
		>
			<span>Discord</span>
		</a>
	);
}
