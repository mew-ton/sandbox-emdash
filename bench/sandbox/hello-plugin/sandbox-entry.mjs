// Minimal sandboxed plugin for scenario 4-7: one content hook, no network.
export default {
	hooks: {
		"content:afterSave": async (event, ctx) => {
			ctx.log.info("saved", { id: event.content?.id });
		},
	},
};
