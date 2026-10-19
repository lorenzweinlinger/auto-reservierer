// Settings for the Auto-Reservierer. Edit names and cars here.
// Leave supabaseUrl / supabaseKey empty to try the app in demo mode (code: demo).
window.APP_CONFIG = {
  supabaseUrl: "https://iygnrdyykhgmysaycspt.supabase.co",
  supabaseKey: "sb_publishable_rrkVpdSpT7zTbd2LptROcQ_bw8sFH6i",

  people: ["Günther", "Evi", "Felix", "Lilly", "Lorenz"],

  // `id` is stored with each reservation – don't change it later. `name` and `color` can change anytime.
  cars: [
    { id: "hyundai", name: "Hyundai", color: "#2f6fe0" },
    { id: "tesla", name: "Tesla", color: "#e0721f" },
  ],
};
