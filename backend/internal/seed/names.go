package seed

import mrand "math/rand/v2"

// Russian name pools for realistic demo users. Surnames are stored in masculine
// base form; the feminine form appends "а" (works for the -ов/-ев/-ёв/-ин/-ын
// endings used here). Patronymics are stored as parallel masculine/feminine
// slices sharing an index (same father name).

var maleFirstNames = []string{
	"Александр", "Дмитрий", "Максим", "Сергей", "Андрей", "Алексей", "Артём",
	"Илья", "Кирилл", "Михаил", "Никита", "Матвей", "Роман", "Егор", "Арсений",
	"Иван", "Денис", "Евгений", "Даниил", "Тимофей", "Владислав", "Игорь",
	"Владимир", "Павел", "Марк", "Константин", "Тимур", "Олег", "Антон", "Глеб",
}

var femaleFirstNames = []string{
	"Анастасия", "Мария", "Анна", "Виктория", "Екатерина", "Наталья", "Полина",
	"Елизавета", "Александра", "Дарья", "Ксения", "София", "Алиса", "Валерия",
	"Арина", "Вероника", "Кристина", "Юлия", "Ольга", "Татьяна", "Маргарита",
	"Елена", "Милана", "Варвара", "Алёна", "Ангелина", "Диана", "Карина", "Вера",
	"Любовь",
}

var surnameBases = []string{
	"Иванов", "Петров", "Смирнов", "Кузнецов", "Попов", "Соколов", "Лебедев",
	"Козлов", "Новиков", "Морозов", "Волков", "Алексеев", "Васильев", "Зайцев",
	"Павлов", "Семёнов", "Голубев", "Виноградов", "Богданов", "Воробьёв",
	"Фёдоров", "Михайлов", "Беляев", "Тарасов", "Белов", "Комаров", "Орлов",
	"Киселёв", "Макаров", "Андреев",
}

var (
	malePatronymics = []string{
		"Александрович", "Дмитриевич", "Сергеевич", "Андреевич", "Алексеевич",
		"Иванович", "Михайлович", "Николаевич", "Петрович", "Владимирович",
		"Максимович", "Артёмович", "Игоревич", "Олегович", "Романович",
	}
	femalePatronymics = []string{
		"Александровна", "Дмитриевна", "Сергеевна", "Андреевна", "Алексеевна",
		"Ивановна", "Михайловна", "Николаевна", "Петровна", "Владимировна",
		"Максимовна", "Артёмовна", "Игоревна", "Олеговна", "Романовна",
	}
)

// randomPerson returns a gender-consistent (first, last, middle) Russian name.
func randomPerson() (first, last, middle string) {
	pat := mrand.IntN(len(malePatronymics))
	if mrand.IntN(2) == 0 { // male
		return maleFirstNames[mrand.IntN(len(maleFirstNames))],
			surnameBases[mrand.IntN(len(surnameBases))],
			malePatronymics[pat]
	}
	return femaleFirstNames[mrand.IntN(len(femaleFirstNames))],
		surnameBases[mrand.IntN(len(surnameBases))] + "а",
		femalePatronymics[pat]
}
