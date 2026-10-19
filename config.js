// Settings for the Auto-Reservierer. Edit names and cars here.
// Leave supabaseUrl / supabaseKey empty to try the app in demo mode (code: demo).
window.APP_CONFIG = {
  supabaseUrl: "",
  supabaseKey: "",

  people: ["Person 1", "Person 2", "Person 3", "Person 4", "Person 5"],

  // `id` is stored with each reservation – don't change it later. `name` and `color` can change anytime.
  cars: [
    { id: "auto1", name: "Auto 1", color: "#2f6fe0" },
    { id: "auto2", name: "Auto 2", color: "#e0721f" },
  ],
};
