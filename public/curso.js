// Mostra só os cursos da escola escolhida.
const school = document.getElementById('school-select');
const course = document.getElementById('course-select');
if (school && course) {
  const groups = [...course.querySelectorAll('optgroup')];
  const update = (keepSelection) => {
    for (const g of groups) {
      const on = g.dataset.school === school.value;
      g.hidden = !on;
      g.disabled = !on;
    }
    const sel = course.selectedOptions[0];
    if (!keepSelection || (sel && sel.parentElement.disabled)) course.value = '';
    course.disabled = !school.value;
  };
  school.addEventListener('change', () => update(false));
  update(true);
}
