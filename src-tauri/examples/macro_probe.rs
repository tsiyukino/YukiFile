// Does register_commands! actually expand and compile?
fn main() {
    let builder = tauri::Builder::default();
    let _built = yukifile::register_commands!(builder);
    println!("macro expanded and compiled");
}
