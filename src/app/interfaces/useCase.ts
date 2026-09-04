/**
 * Contrato común de la capa de aplicación: un caso de uso recibe un comando
 * y devuelve un resultado (o void). Las implementaciones viven en src/app/useCases/.
 */
export interface UseCase<Command, Result> {
  execute(command: Command): Promise<Result>;
}