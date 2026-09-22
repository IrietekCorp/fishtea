/**
 * Stands in for `react-devtools-core`, which Ink imports to attach the React devtools when DEV=true.
 *
 * The import is already conditional in Ink's reconciler, but `bun build --compile` folds a dynamic import
 * with a static specifier into the single-file bundle and evaluates it eagerly — so without this the
 * compiled binary fails on startup with "Cannot find package 'react-devtools-core'", on every command,
 * including `--version`.
 *
 * A shipped operator console has no business attaching devtools, so the honest stand-in is a no-op that
 * says what happened if anything ever reaches it.
 */
const unavailable = (name: string) => () => {
  throw new Error(`react-devtools-core is not bundled into the fishtea binary (${name}). Run the console from a framework checkout if you need it.`);
};

export const connectToDevTools = unavailable("connectToDevTools");
export const connectWithCustomMessagingProtocol = unavailable("connectWithCustomMessagingProtocol");
export const setIsAppActive = () => {};
export const initialize = () => {};
export default { connectToDevTools, connectWithCustomMessagingProtocol, setIsAppActive, initialize };
