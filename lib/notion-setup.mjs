const REQUIRED_PROPERTIES = [
  ['작업', ['작업', '이름', 'Name']],
  ['상태', ['Status', '상태']],
  ['담당자', ['담당자']],
  ['상위 항목', ['상위 항목', '부모 항목', 'Parent item']],
  ['기간', ['시작날짜 <-> Dead Line', '기간', '날짜']],
  ['프로젝트', ['프로젝트']],
  ['스프린트', ['스프린트', 'Sprint']],
  ['우선순위', ['우선순위']],
  ['브랜치', ['브랜치', 'Branch', 'Git 브랜치', 'GitHub 브랜치']],
];

export function inspectWorkDatabaseSetup(databases) {
  const inspected = databases.map(database => {
    const propertyNames = Object.keys(database.properties || {});
    const missingProperties = REQUIRED_PROPERTIES
      .filter(([, aliases]) => !aliases.some(alias => propertyNames.includes(alias)))
      .map(([label]) => label);
    return {
      id: database.id,
      title: database.title,
      propertyNames,
      missingProperties,
      ready: missingProperties.length === 0,
    };
  });
  return {
    ready: inspected.length > 0 && inspected.every(database => database.ready),
    databases: inspected,
  };
}
