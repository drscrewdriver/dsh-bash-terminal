// Hand-written boundary types for the DSH seams this plugin consumes.
//
// The @deepseek-ai/* packages ship their own .d.ts, but their full generic
// surface (cordis Context augmentation, agent/session graphs) is far wider
// than what a plugin touches. These structural types describe exactly the
// face this plugin programs against — call them the plugin's side of the
// contract. Value imports stay on the real packages (see ./dsh.ts); only
// the shapes live here, so peer version drift cannot ripple into this tree.
export {};
